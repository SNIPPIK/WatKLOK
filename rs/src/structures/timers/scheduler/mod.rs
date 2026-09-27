pub mod constants;
pub mod telemetry;
pub mod timer;
pub mod registry;
mod budget;
pub mod balancer;

use std::io;
use std::sync::{Arc, Mutex, Condvar, atomic::{AtomicBool, Ordering}};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

// Импортируем ваши внешние структуры (пути должны соответствовать вашему проекту)
use crate::structures::timers::scheduler::{budget::SendBudget};
use crate::utils::duration::now_ms;

use self::registry::SessionRegistry;
use self::telemetry::{SchedulerTelemetry, update_ema};
use self::timer::{PrecisionTimer};
use self::constants::*;

/// Всё состояние, которое нужно фоновому потоку воркера.
///
/// Раньше в поток пробрасывалось четыре отдельных `Arc` (`registry`,
/// `running`, `wake_state`, `telemetry`). Здесь они объединены в одну
/// структуру и заворачиваются в единственный `Arc`, что даёт:
/// - один клон вместо четырёх при спавне потока;
/// - одну косвенность до `registry` вместо двух (раньше был
///   `Arc<SessionRegistry>` внутри уже общего состояния).
struct WorkerShared {
    /// Реестр активных сессий (lock-free чтение через `ArcSwap`).
    registry: SessionRegistry,

    /// Флаг активности воркер-потока. Проверяется в горячем пути
    /// (`cycle_thread`, `PrecisionTimer::wait_until`) без блокировок.
    /// Единственный источник истины о его согласованности с реальным
    /// потоком — `Scheduler::worker` (см. ниже).
    running: AtomicBool,

    /// Пара (флаг пробуждения, condvar) для досрочного выхода из ожидания.
    wake_state: (Mutex<bool>, Condvar),

    /// Метрики планировщика, разделяемые с воркером.
    telemetry: SchedulerTelemetry,
}

/// Дескриптор фонового потока. `Some` означает "поток запущен (или ещё не
/// успел выйти)", `None` — "поток не запущен".
///
/// Вынесен в отдельный тип, чтобы решения "запустить" (`add_session`) и
/// "остановить, потому что реестр опустел" (`remove_session`) принимались
/// строго под одним и тем же `Mutex`. Раньше это были две независимые
/// операции (`AtomicBool::compare_exchange` в `start_if_needed` и
/// отдельная проверка `registry.is_empty()` в `remove_session`), из-за чего
/// был возможен следующий сценарий:
///
/// 1. Поток A вызывает `remove_session`, реестр становится пустым.
/// 2. Поток B вызывает `add_session`, кладёт новую сессию в реестр и
///    видит `running == true` — решает, что воркер уже работает, и ничего
///    не запускает.
/// 3. Поток A видит, что реестр пуст (шаг 1 уже произошёл до шага 2 с его
///    точки зрения), и останавливает воркер.
///
/// В итоге сессия из шага 2 остаётся в реестре, а воркера, который бы её
/// обработал, больше нет — до следующего вызова `add_session` с другим id.
/// Поскольку и старт, и проверка пустоты реестра перед остановкой теперь
/// выполняются под одним `worker`-локом, такие сценарии линеаризуются:
/// какой бы поток ни захватил лок первым, второй увидит уже актуальное
/// состояние (либо реестр не пуст — останавливать нельзя, либо воркер уже
/// остановлен — надо запускать заново).
#[derive(Default)]
struct WorkerHandle {
    handle: Option<JoinHandle<()>>,
}

/// Планировщик циклической обработки UDP-сессий.
///
/// Запускает фоновый поток, который с интервалом `TICK_INTERVAL` вызывает
/// `tick()` у всех активных сессий. Использует `SessionRegistry` для
/// lock-free чтения снимка сессий, `PrecisionTimer` — для точного ожидания
/// дедлайна, `SchedulerTelemetry` — для сбора метрик и адаптации параметров.
///
/// Поток запускается лениво при первом вызове `add_session` и автоматически
/// останавливается, когда реестр становится пустым.
pub struct Scheduler {
    /// Общее состояние, доступное и `Scheduler`, и фоновому потоку.
    shared: Arc<WorkerShared>,

    /// Дескриптор воркера. Все переходы "запущен ↔ остановлен" проходят
    /// через этот `Mutex` — см. документацию `WorkerHandle`.
    worker: Mutex<WorkerHandle>,
}

impl Scheduler {
    /// Создаёт планировщик в остановленном состоянии.
    /// Воркер не запускается до первого `add_session`.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            shared: Arc::new(WorkerShared {
                registry: SessionRegistry::new(),
                running: AtomicBool::new(false),
                wake_state: (Mutex::new(false), Condvar::new()),
                telemetry: SchedulerTelemetry::default(),
            }),
            worker: Mutex::new(WorkerHandle::default()),
        })
    }

    /// Добавляет сессию в реестр, запускает воркер (если не запущен)
    /// и будит его для немедленной обработки.
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
    #[inline]
    pub fn add_session(&self, id: u32, session: Arc<crate::structures::network::udp::socket::SocketBuffered>) {
        // Добавляем в реестр до захвата worker-лока: remove_session,
        // захватив лок позже, увидит уже непустой реестр (см. документацию
        // WorkerHandle) и не станет останавливать воркер, который мы,
        // возможно, только что решили не трогать.
        self.shared.registry.add(id, session);

        {
            let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
            if worker.handle.is_none() {
                self.spawn_worker(&mut worker);
            }
            // Лок отпускается здесь — незачем держать его во время wake_thread.
        }

        // Будим воркер, чтобы он не ждал следующего тика.
        self.wake_thread();
    }

    /// Удаляет сессию из реестра.
    /// Если реестр опустел — останавливает воркер.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    #[inline]
    pub fn remove_session(&self, id: u32) {
        self.shared.registry.remove(id);

        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        if self.shared.registry.is_empty() {
            // Проверка пустоты и остановка выполняются под тем же локом,
            // что и старт в add_session — гонка, описанная в документации
            // WorkerHandle, невозможна.
            self.shutdown_locked(&mut worker);
        } else {
            drop(worker);
            // Иначе будим воркер, чтобы он увидел изменения реестра.
            self.wake_thread();
        }
    }

    /// Запускает воркер-поток. Вызывающий обязан держать `worker`-лок и
    /// убедиться, что `worker.handle.is_none()`.
    fn spawn_worker(&self, worker: &mut WorkerHandle) {
        self.shared.running.store(true, Ordering::Release);

        let shared = Arc::clone(&self.shared);

        let spawn = thread::Builder::new()
            .name("UDPCycleSystem".into())
            .spawn(move || cycle_thread(shared));

        match spawn {
            Ok(h) => worker.handle = Some(h),
            Err(e) => {
                // При ошибке спавна откатываем флаг активности, чтобы
                // следующий add_session мог попробовать снова.
                self.shared.running.store(false, Ordering::Release);
                eprintln!("[Scheduler] failed to spawn worker thread: {e}");
            }
        }
    }

    /// Устанавливает флаг пробуждения и уведомляет condvar.
    /// Игнорирует отравление мьютекса, чтобы пробуждение работало всегда.
    #[inline]
    fn wake_thread(&self) {
        let (lock, cvar) = &self.shared.wake_state;
        if let Ok(mut wake) = lock.lock() {
            *wake = true;
            cvar.notify_one();
        } else {
            // При отравлении всё равно уведомляем.
            cvar.notify_one();
        }
    }

    /// Останавливает воркер и дожидается его завершения.
    /// Вызывающий обязан держать `worker`-лок. Идемпотентна: если поток
    /// уже остановлен (`handle.is_none()`), просто ничего не делает с ним.
    fn shutdown_locked(&self, worker: &mut WorkerHandle) {
        self.shared.running.store(false, Ordering::Release);
        self.wake_thread();

        if let Some(h) = worker.handle.take() {
            let _ = h.join();
        }
    }

    /// Останавливает воркер и дожидается его завершения.
    /// Идемпотентен: повторный вызов безопасен.
    #[inline]
    pub fn shutdown(&self) {
        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        self.shutdown_locked(&mut worker);
    }
}

/// Останавливаем воркер при уничтожении планировщика.
impl Drop for Scheduler {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Основной цикл воркера планировщика.
///
/// Фазы одной итерации:
/// 1. Ожидание дедлайна через `PrecisionTimer` (сон → yield → спин).
/// 2. Расчёт джиттера и обновление метрик.
/// 3. Обработка снимка сессий с рассчитанным `SendBudget`.
/// 4. Сбор метрик обработки, сна и спина.
/// 5. Периодическая адаптация `spin_margin` каждые `ADAPT_INTERVAL` тиков.
/// 6. Планирование следующего дедлайна с защитой от дрейфа.
///
/// # Аргументы
/// * `shared` — общее состояние воркера (реестр, флаг активности,
///   состояние пробуждения, телеметрия).
fn cycle_thread(shared: Arc<WorkerShared>) {
    // Медианный overshoot коротких снов даёт оценку минимального шага.
    let granularity = measure_sleep_granularity();
    shared.telemetry.sleep_granularity_ns.store(granularity.as_nanos() as u64, Ordering::Relaxed);

    // Установка начального запаса для спина: 2 × гранулярность в пределах MIN/MAX.
    let initial_margin = granularity.saturating_mul(2).max(MIN_SPIN_MARGIN).min(MAX_SPIN_MARGIN);
    shared.telemetry.spin_margin_ns.store(initial_margin.as_nanos() as u64, Ordering::Relaxed);

    // Первый тик выполняется сразу (дедлайн = now).
    let mut next_deadline = Instant::now();

    while shared.running.load(Ordering::Acquire) {
        // Фиксируем время начала итерации (для метрики process).
        let tick_start = Instant::now();

        // Ожидание следующего тика (сон → yield → спин).
        let outcome = PrecisionTimer::wait_until(
            next_deadline,
            &shared.running,
            &shared.wake_state,
            &shared.telemetry,
        );
        // Если воркер остановили во время ожидания — выходим.
        if !outcome.reached_deadline { break; }

        // Время сразу после пробуждения — используется для расчёта
        // джиттера (насколько опоздали относительно дедлайна).
        let wait_now = Instant::now();

        // Расчёт опоздания (джиттер).
        let late = if wait_now > next_deadline {
            let diff = wait_now.duration_since(next_deadline);
            let jitter_ns = diff.as_nanos() as u64;
            // EMA + максимум.
            update_ema(&shared.telemetry.avg_jitter_ns, jitter_ns, ALPHA_SHIFT);
            shared.telemetry.max_jitter_ns.fetch_max(jitter_ns, Ordering::Relaxed);
            diff
        } else {
            Duration::ZERO
        };

        // Обработка сессий.
        let snapshot = shared.registry.snapshot();
        if !snapshot.is_empty() {
            // Определяем бюджет отправки по величине опоздания.
            let budget = SendBudget::calculate_send_budget(late);

            // Один timestamp на все сессии — обход снимка быстрый.
            let timestamp = now_ms();
            for session in snapshot.values() {
                session.tick(timestamp, budget.packets());
            }
        }

        // Сбор метрик выполнения.
        let process_ns = tick_start.elapsed().as_nanos() as u64;
        update_ema(&shared.telemetry.avg_process_ns, process_ns, ALPHA_SHIFT);
        shared.telemetry.max_process_ns.fetch_max(process_ns, Ordering::Relaxed);

        let sleep_overshoot_ns = outcome.sleep_overshoot.as_nanos() as u64;
        update_ema(&shared.telemetry.avg_sleep_overshoot_ns, sleep_overshoot_ns, ALPHA_SHIFT);
        shared.telemetry.max_sleep_overshoot_ns.fetch_max(sleep_overshoot_ns, Ordering::Relaxed);

        let spin_ns = outcome.spin_time.as_nanos() as u64;
        update_ema(&shared.telemetry.avg_spin_time_ns, spin_ns, ALPHA_SHIFT);

        // Адаптация spin_margin каждые N циклов.
        let cycle_id = shared.telemetry.ticks.fetch_add(1, Ordering::Relaxed) + 1;
        if cycle_id % ADAPT_INTERVAL == 0 {
            let avg_spin = Duration::from_nanos(shared.telemetry.avg_spin_time_ns.load(Ordering::Relaxed));
            let avg_overshoot = Duration::from_nanos(shared.telemetry.avg_sleep_overshoot_ns.load(Ordering::Relaxed));
            PrecisionTimer::adapt_margin(&shared.telemetry, avg_spin, avg_overshoot);
        }

        // Расчёт следующего дедлайна (строго +20 мс для исключения дрейфа).
        next_deadline += TICK_INTERVAL;

        // Если катастрофически отстали — сбрасываем дедлайн на now + интервал.
        // Иначе можно было бы накопить серию «догоняющих» тиков.
        //
        // Важно: время для этой проверки берём заново, ПОСЛЕ обработки
        // сессий и метрик, а не переиспользуем `wait_now`. Если сама
        // обработка (или адаптация spin_margin) заняла заметное время,
        // `wait_now` уже устарел и мог бы скрыть реальное отставание,
        // накопленное уже после пробуждения.
        let post_process_now = Instant::now();
        if next_deadline <= post_process_now {
            next_deadline = post_process_now + TICK_INTERVAL;
        }
    }

    // По завершении цикла сбрасываем флаг активности.
    shared.running.store(false, Ordering::Release);
}

/// Измеряет гранулярность системного сна.
///
/// Делает `SAMPLES` коротких снов длительностью `REQUESTED_SLEEP`,
/// собирает превышения фактического времени над запрошенным и возвращает
/// медианный overshoot, ограниченный `MAX_GRANULARITY`.
///
/// # Возвращаемое значение
/// Медианный overshoot сна; `ZERO`, если замеры не удались.
#[inline]
fn measure_sleep_granularity() -> Duration {
    // Сюда собираем все превышения.
    let mut overshoots = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        // Засекаем время до сна.
        let start = Instant::now();
        thread::sleep(REQUESTED_SLEEP);
        // Фактическая длительность.
        let elapsed = start.elapsed();

        // Записываем только промахи.
        if elapsed > REQUESTED_SLEEP {
            overshoots.push(elapsed - REQUESTED_SLEEP);
        }
    }

    // Если ни одного промаха не зафиксировано — гранулярность нулевая.
    if overshoots.is_empty() { return Duration::ZERO; }

    // Сортируем и берём медиану (устойчива к одиночным выбросам).
    overshoots.sort_unstable();
    overshoots[overshoots.len() / 2].min(MAX_GRANULARITY)
}