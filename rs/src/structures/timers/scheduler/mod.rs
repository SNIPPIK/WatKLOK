pub mod constants;
pub mod telemetry;
pub mod timer;
pub mod registry;
mod budget;
pub mod balancer;

use std::io;
use std::sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}};
use std::time::{Duration, Instant};

use std::thread;

use tokio::sync::Notify;

use crate::structures::timers::scheduler::budget::SendBudget;
use crate::utils::duration::mono_ms;
use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::structures::network::udp::inner_socket::SocketInner;
use self::registry::SessionRegistry;
use self::telemetry::{SchedulerTelemetry, update_ema};
use self::timer::PrecisionTimer;
use self::constants::*;

/// Всё состояние, которое нужно async-воркеру.
///
/// Живёт в `Arc`: на него смотрит задача цикла, а через `Scheduler` —
/// методы `add_session`/`remove_session`. Прямые ссылки между
/// `Scheduler` и задачей создали бы цикл: задача → `WorkerShared` →
/// `Scheduler` → `WorkerHandle` → задача.
struct WorkerShared {
    /// Реестр сессий (lock-free чтение через `ArcSwap`).
    ///
    /// Чтение — горячий путь (каждый тик обходит все сессии), запись —
    /// редкая (add/remove). `ArcSwap` даёт читателям снимок без блокировок;
    /// ценой copy-on-write при обновлении.
    registry: SessionRegistry,

    /// Текущее поколение воркера. `0` — воркер не запущен. Каждый `spawn`
    /// увеличивает счётчик; задача помнит своё поколение и завершается,
    /// если оно перестало быть текущим. Это защищает от гонки «старый
    /// воркер просыпается уже после старта нового и продолжает работать».
    ///
    /// Почему не `AtomicBool`: `bool` не различает «старая задача
    /// проснулась после abort» и «новая ещё не стартовала». Поколение
    /// решает это одним сравнением: `my_generation != current` = «я больше
    /// не текущий».
    current_generation: AtomicU64,

    /// Сериализует обработку тиков.
    ///
    /// Старый воркер, уже получивший сигнал остановки, может ещё доделывать
    /// свой последний тик, пока новый воркер стартует. Без этого лока обе
    /// задачи отправляли бы пакеты одной сессии одновременно (двойная скорость
    /// и сбитые RTP-метки). Под локом поколение перепроверяется: устаревший
    /// воркер тик не выполняет.
    tick_lock: Mutex<()>,

    /// Notify для досрочного пробуждения воркера (изменение реестра).
    /// Без него тик ждал бы весь `TICK_INTERVAL`, даже если сессии
    /// появились только что.
    wake: Notify,

    /// Метрики.
    telemetry: SchedulerTelemetry
}

/// Дескриптор воркера. `Some` = поток запущен, `None` = не запущен.
///
/// Все переходы «запущен ↔ остановлен» проходят через `Scheduler::worker`
/// (`Mutex`), что линеаризует add/remove/shutdown и исключает классическую
/// гонку «remove_session опустошил реестр, а add_session уже видит
/// `running=true`».
#[derive(Default)]
struct WorkerHandle {
    thread: Option<thread::JoinHandle<()>>
}

/// Планировщик циклической обработки UDP-сессий (Tokio).
///
/// Запускает цикл, который с интервалом `TICK_INTERVAL` вызывает
/// `auto_tick()` у всех активных сессий. Использует `SessionRegistry` для
/// lock-free чтения снимка, `PrecisionTimer` — для точного ожидания
/// дедлайна, `SchedulerTelemetry` — для метрик.
///
/// ## Где выполняется цикл
///
/// На выделенном потоке `voice-timer` с собственным однопоточным tokio-рантаймом
/// (только time-драйвер). Вызывающему не нужен tokio-контекст: `add_session` и
/// `remove_session` можно вызывать из любого потока. Цикл изолирован от общего
/// рантайма `voice-ws`, поэтому тяжёлая работа WebSocket/TLS/MLS не задерживает
/// отправку аудио, а спин (до ~1.5 мс на тик) не блокирует чужие задачи.
pub struct Scheduler {
    /// Общее состояние, доступное и `Scheduler`, и фоновому потоку.
    shared: Arc<WorkerShared>,

    /// Дескриптор воркера. Все переходы "запущен ↔ остановлен" проходят
    /// через этот `Mutex` — см. документацию `WorkerHandle`.
    worker: Mutex<WorkerHandle>
}

impl Scheduler {
    /// Создаёт планировщик в остановленном состоянии.
    /// Воркер не запускается до первого `add_session`.
    pub fn new() -> Self {
        Self {
            shared: Arc::new(WorkerShared {
                registry: SessionRegistry::new(),
                current_generation: AtomicU64::new(0),
                tick_lock: Mutex::new(()),
                wake: Notify::new(),
                telemetry: SchedulerTelemetry::default(),
            }),
            worker: Mutex::new(WorkerHandle::default())
        }
    }

    /// Добавляет сессию в реестр, запускает воркер (если не запущен)
    /// и будит его.
    ///
    /// # Ошибки
    /// Если не удалось собрать рантайм или запустить поток воркера — сессия
    /// убирается из реестра и возвращается ошибка.
    pub fn add_session(&self, id: u32, session: Arc<SocketInner>) -> io::Result<()> {
        // Сначала кладём в реестр — задача, если уже запущена, увидит
        // её на следующем тике. Если не запущена — увидит сразу после
        // `spawn_worker` (задача стартует с пустым `next_deadline`).
        self.shared.registry.add(id, session);

        {
            let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());

            // Задача могла завершиться сама (например, паника в auto_tick).
            // `is_finished()` возвращает true и для паники. Отцепляем handle —
            // результат паники нам не нужен, важно перезапустить воркер.
            //
            // Если не отцепить, `worker.handle.is_none()` будет false,
            // и новый воркер не запустится — сессии останутся в реестре
            // без обработчика.
            if worker
                .thread
                .as_ref()
                .is_some_and(thread::JoinHandle::is_finished)
            {
                worker.thread.take();
            }

            if worker.thread.is_none() {
                if let Err(error) = self.spawn_worker(&mut worker) {
                    // Откат: если runtime недоступен, сессия не должна
                    // остаться в реестре — иначе следующая попытка
                    // `add_session` увидит её как «уже добавленную»
                    // и попытается перезаписать. Плюс это утечка
                    // `Arc<SocketInner>`.
                    drop(worker);
                    self.shared.registry.remove(id);
                    return Err(error);
                }
            }
        }

        // Будим воркер: он мог спать до конца `TICK_INTERVAL`, а новая
        // сессия должна быть обработана уже на ближайшем тике.
        self.wake_thread();
        Ok(())
    }

    /// Удаляет сессию. Если реестр опустел — инициирует остановку воркера
    /// (best-effort: abort, без ожидания — синхронный API).
    #[inline]
    pub fn remove_session(&self, id: u32) {
        self.shared.registry.remove(id);

        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        if self.shared.registry.is_empty() {
            // Пустой реестр = нечего тикать. Останавливаем воркер, чтобы
            // не жечь CPU вхолостую. `shutdown_locked` снимает handle;
            // следующий `add_session` его пересоздаст.
            self.shutdown_locked(&mut worker);
        } else {
            // Остальные сессии живы — просто будим воркер, чтобы
            // удаление вступило в силу на ближайшем тике. Без `notify`
            // задача могла бы проснуться с устаревшим снимком реестра
            // (хотя `ArcSwap` даёт консистентность, но не гарантирует,
            // что `snapshot()` увидит изменения без явного пробуждения).
            drop(worker);
            self.wake_thread();
        }
    }

    /// Запускает async-воркер. Вызывающий держит `worker`-лок и убедился,
    /// что `worker.handle.is_none()`.
    fn spawn_worker(&self, worker: &mut WorkerHandle) -> io::Result<()> {
        // Цикл тиков живёт на ВЫДЕЛЕННОМ потоке со своим однопоточным
        // tokio-рантаймом (нужен только time-драйвер), а не на общем рантайме
        // `voice-ws`. Причины:
        //
        // * на общем рантайме тик делит воркер-потоки с WebSocket, TLS и
        //   тяжёлыми задачами MLS/DAVE: рукопожатие (оно как раз в начале
        //   сессии) задерживало тики на десятки миллисекунд, а где окажется
        //   задача, зависело от везения при старте;
        // * цикл намеренно блокирует поток спином до ~1.5 мс на тик, чужие
        //   задачи на этом воркере в это время стоят;
        // * `add_session` не зависит от того, из какого потока его вызвали.
        //
        // Рантайм собираем ДО запуска потока, чтобы ошибка вернулась
        // вызывающему, а не потерялась внутри потока.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()?;

        // Поколение строго монотонно и НИКОГДА не обнуляется (см.
        // `shutdown_locked`): иначе номер переиспользовался бы, и остановленный
        // воркер, не успевший заметить остановку, снова считал бы себя текущим.
        let my_generation = self.shared.current_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let shared = Arc::clone(&self.shared);

        let thread = thread::Builder::new()
            .name("voice-timer".into())
            .spawn(move || {
                runtime.block_on(cycle_task(shared, my_generation));
            })?;

        worker.thread = Some(thread);
        Ok(())
    }

    /// Уведомляет воркер о досрочном пробуждении.
    #[inline]
    fn wake_thread(&self) {
        // `notify_one`, а не `notify_waiters`: воркер один, и `notify_one`
        // дешевле — не перебирает всех ожидающих. Если бы воркеров
        // было несколько, понадобился бы `notify_waiters`.
        self.shared.wake.notify_one();
    }

    /// Останавливает воркер (best-effort, sync). Идемпотентна.
    ///
    /// * `fetch_add(1)` — новое поколение: воркер с прежним номером при ближайшей
    ///   проверке видит несовпадение и завершается. Поколение не обнуляется,
    ///   иначе следующий `spawn_worker` выдал бы тот же номер.
    /// * `notify_waiters()` — будит воркер, если он спит в `select!`.
    /// * Поток не `join`-им (API синхронный): он выходит сам не позднее чем
    ///   через один шаг ожидания. `JoinHandle` отпускается.
    fn shutdown_locked(&self, worker: &mut WorkerHandle) {
        self.shared.current_generation.fetch_add(1, Ordering::AcqRel);
        self.shared.wake.notify_waiters();
        worker.thread.take();
    }

    /// Останавливает воркер (best-effort, sync). Идемпотентен.
    #[inline]
    pub fn shutdown(&self) {
        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        self.shutdown_locked(&mut worker);
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        // Явный shutdown: `JoinHandle` при `Drop` не останавливает задачу,
        // только отцепляет её. Без этого задача жила бы до конца runtime.
        self.shutdown();
    }
}

/// Основной async-цикл воркера.
///
/// Отличие от thread-версии — только точки `.await`:
/// * `wait_until` — async;
/// * `measure_sleep_granularity` — async (через `tokio::time::sleep`).
///
/// Проверка поколения (`current_generation.load() == my_generation`)
/// заменяет `AtomicBool::running` и защищает от гонки «старый воркер
/// проснулся после старта нового».
async fn cycle_task(shared: Arc<WorkerShared>, my_generation: u64) {
    // Гранулярность сна измеряется один раз при старте: она нужна
    // для `PrecisionTimer` (минимальный `spin_margin`) и в `adapt_margin`.
    // Измерение занимает несколько десятков миллисекунд — один раз
    // на воркер это приемлемо.
    let granularity = measure_sleep_granularity().await;
    shared
        .telemetry
        .sleep_granularity_ns
        .store(granularity.as_nanos() as u64, Ordering::Relaxed);

    // Начальный `spin_margin`: не меньше удвоенной гранулярности сна,
    // но в пределах `[MIN_SPIN_MARGIN, MAX_SPIN_MARGIN]`. Нижняя граница
    // гарантирует, что спин «накроет» промах сна; верхняя — что
    // спин не съест слишком много CPU.
    //
    // Стартуем с МАКСИМАЛЬНОГО запаса, а не со значения, выведенного из
    // 10 замеров: замер зависит от загрузки в момент старта и от фазы
    // 1-мс колеса таймеров tokio, а адаптация меняет запас не быстрее 10%
    // за `ADAPT_INTERVAL` тиков. Неудачный замер оставлял воркер минутами
    // с неточными тиками. Теперь запас только уменьшается (экономия CPU),
    // а точность держит порог ухода со `sleep` (`TIMER_RESOLUTION`).
    let initial_margin = MAX_SPIN_MARGIN;
    shared
        .telemetry
        .spin_margin_ns
        .store(initial_margin.as_nanos() as u64, Ordering::Relaxed);

    // `next_deadline` — момент следующего тика. Изначально `now`: первый
    // тик должен произойти как можно скорее (особенно если `add_session`
    // уже положил сессию в реестр до старта задачи).
    let mut next_deadline = Instant::now();

    while shared.current_generation.load(Ordering::Acquire) == my_generation {
        let outcome = PrecisionTimer::wait_until(
            next_deadline,
            &shared.current_generation,
            my_generation,
            &shared.wake,
            &shared.telemetry,
        )
            .await;

        // `reached_deadline = false` = отмена (поколение сменилось или
        // воркер остановлен). Задача завершается, не дожидаясь следующего
        // тика.
        if !outcome.reached_deadline {
            break;
        }

        // Один обработчик тиков за раз. Устаревший воркер (его уже сменили)
        // мог дойти досюда, пока новый стартует; под локом поколение
        // перепроверяется, и он тик не выполняет. Гард живёт до конца
        // итерации и не пересекает `.await`: все ожидания выше.
        let _tick_guard = shared.tick_lock.lock().unwrap_or_else(|e| e.into_inner());
        if shared.current_generation.load(Ordering::Acquire) != my_generation {
            break;
        }

        let tick_start = Instant::now();
        let wait_now = Instant::now();

        // Опоздание тика: `wait_now - next_deadline`. Если положительное —
        // мы проспали, и `SendBudget` уменьшит `budget`, чтобы не отправлять
        // «догоняющий» залп. Метрики (`avg_jitter_ns`, `max_jitter_ns`)
        // нужны для диагностики: постоянный jitter — сигнал, что воркеров
        // не хватает или `TICK_INTERVAL` слишком мал.
        let late = if wait_now > next_deadline {
            let diff = wait_now.duration_since(next_deadline);
            let jitter_ns = diff.as_nanos() as u64;

            // EMA + максимум.
            update_ema(&shared.telemetry.avg_jitter_ns, jitter_ns, ALPHA_SHIFT);
            shared
                .telemetry
                .max_jitter_ns
                .fetch_max(jitter_ns, Ordering::Relaxed);
            diff
        } else {
            Duration::ZERO
        };

        // `snapshot()` — lock-free снимок реестра через `ArcSwap`.
        // Пока мы тикаем, `add_session`/`remove_session` могут менять
        // реестр; снимок даёт консистентный набор на момент `load()`.
        // Изменения, пришедшие после снимка, увидят следующий тик —
        // это допустимо (add/remove в любом случае асинхронны).
        let snapshot = shared.registry.snapshot();
        if !snapshot.is_empty() {
            // `budget` зависит от `late`: если мы опоздали, бюджет
            // уменьшается, чтобы не отправлять «залп» пакетов разом
            // и не переполнять сеть. Это защита от «наверстать упущенное»
            // на каждом тике.
            let budget = SendBudget::calculate_send_budget(late);
            let timestamp = mono_ms();

            for session in snapshot.values() {
                // `catch_unwind`: паника в `auto_tick` одной сессии
                // не должна валить весь воркер и все остальные сессии.
                // Без этого одна сломанная сессия заблокировала бы тик
                // для всех остальных — и UDP для них бы «замер».
                //
                // `AssertUnwindSafe` — потому что `auto_tick` работает
                // с `&self` и атомиками; паника в одном поле не оставит
                // структуру в «полуразобранном» состоянии, безопасно
                // продолжать.
                let _ = catch_unwind(AssertUnwindSafe(|| {
                    session.auto_tick(timestamp, budget.packets());
                }));
            }
        }

        // Метрики времени обработки — для диагностики «тик слишком
        // долгий» и для `adapt_margin` (если обработка занимает много
        // времени, `next_deadline` быстро отстаёт, и это видно по `late`).
        let process_ns = tick_start.elapsed().as_nanos() as u64;
        update_ema(&shared.telemetry.avg_process_ns, process_ns, ALPHA_SHIFT);
        shared
            .telemetry
            .max_process_ns
            .fetch_max(process_ns, Ordering::Relaxed);

        // Overshoot сна — метрика для `adapt_margin`: если сон регулярно
        // просыпается позже дедлайна, нужно увеличить `spin_margin`,
        // чтобы спин «накрывал» промах.
        let sleep_overshoot_ns = outcome.sleep_overshoot.as_nanos() as u64;
        update_ema(
            &shared.telemetry.avg_sleep_overshoot_ns,
            sleep_overshoot_ns,
            ALPHA_SHIFT,
        );
        shared
            .telemetry
            .max_sleep_overshoot_ns
            .fetch_max(sleep_overshoot_ns, Ordering::Relaxed);

        // Сколько времени провели в спине — метрика для `adapt_margin`:
        // слишком долгий спин жжёт CPU, слишком короткий — теряет точность.
        let spin_ns = outcome.spin_time.as_nanos() as u64;
        update_ema(&shared.telemetry.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        // Адаптация `spin_margin` раз в `ADAPT_INTERVAL` тиков, а не
        // на каждом: одно измерение — шум, и реагировать на него
        // значит раскачивать `spin_margin` из стороны в сторону.
        let cycle_id = shared.telemetry.ticks.fetch_add(1, Ordering::Relaxed) + 1;
        if cycle_id % ADAPT_INTERVAL == 0 {
            let avg_spin = Duration::from_nanos(
                shared.telemetry.avg_spin_time_ns.load(Ordering::Relaxed),
            );
            let avg_overshoot = Duration::from_nanos(
                shared
                    .telemetry
                    .avg_sleep_overshoot_ns
                    .load(Ordering::Relaxed),
            );
            PrecisionTimer::adapt_margin(&shared.telemetry, avg_spin, avg_overshoot);
        }

        // Следующий дедлайн — ровно через `TICK_INTERVAL`. `+=` вместо
        // `now + TICK_INTERVAL`: если обработка была быстрой и мы
        // уложились в интервал, дедлайны идут равномерно (без дрейфа).
        next_deadline += TICK_INTERVAL;

        // Если обработка заняла больше `TICK_INTERVAL`, `next_deadline`
        // уже в прошлом — следующий `wait_until` вернётся сразу и
        // «догонит» тик. Но если мы отстали на несколько тиков,
        // догонять их все подряд бессмысленно: пропущенные пакеты
        // всё равно устарели. Сбрасываем дедлайн на «сейчас + интервал»,
        // чтобы не было лавины догоняющих тиков.
        let post_process_now = Instant::now();
        if next_deadline <= post_process_now {
            next_deadline = post_process_now + TICK_INTERVAL;
        }
    }
}

/// Измеряет гранулярность `tokio::time::sleep`. Та же логика, что и раньше,
/// но через async sleep. Возвращает медианный overshoot, ограниченный
/// `MAX_GRANULARITY`.
async fn measure_sleep_granularity() -> Duration {
    let mut overshoots = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        // Засекаем время до сна.
        let start = Instant::now();

        tokio::time::sleep(REQUESTED_SLEEP).await;
        let elapsed = start.elapsed();
        // Считаем только положительный overshoot: если sleep проснулся
        // раньше запрошенного (бывает на некоторых платформах), это
        // не «гранулярность», а шум — игнорируем.
        if elapsed > REQUESTED_SLEEP {
            overshoots.push(elapsed - REQUESTED_SLEEP);
        }
    }

    if overshoots.is_empty() {
        return Duration::ZERO;
    }

    // Медиана, а не среднее: одно выбросное измерение (например, из-за
    // планировщика ОС) не должно раздувать `granularity` и через неё
    // минимальный `spin_margin`. Медиана устойчивее.
    overshoots.sort_unstable();
    overshoots[overshoots.len() / 2].min(MAX_GRANULARITY)
}
#[cfg(test)]
mod tests {
    use super::*;

    /// Поколение воркера растёт монотонно и не повторяется после остановки:
    /// именно повтор номера позволял «старому» воркеру считать себя текущим.
    #[test]
    fn generation_is_monotonic_across_shutdown_and_respawn() {
        let scheduler = Scheduler::new();
        let mut worker = scheduler.worker.lock().unwrap();

        scheduler.spawn_worker(&mut worker).unwrap();
        let first = scheduler.shared.current_generation.load(Ordering::Acquire);

        scheduler.shutdown_locked(&mut worker);
        let stopped = scheduler.shared.current_generation.load(Ordering::Acquire);
        assert!(stopped > first, "остановка должна менять поколение, а не обнулять его");

        scheduler.spawn_worker(&mut worker).unwrap();
        let second = scheduler.shared.current_generation.load(Ordering::Acquire);
        assert!(second > stopped);
        assert_ne!(first, second);

        scheduler.shutdown_locked(&mut worker);
    }

    /// `add_session`/`spawn_worker` не требуют tokio-контекста у вызывающего.
    #[test]
    fn spawn_worker_works_without_caller_runtime() {
        let scheduler = Scheduler::new();
        let mut worker = scheduler.worker.lock().unwrap();
        assert!(scheduler.spawn_worker(&mut worker).is_ok());
        scheduler.shutdown_locked(&mut worker);
    }
}
