use crate::{
    structures::network::udp::inner_socket::{Prepare, SocketInner},
    utils::duration::{mono_us, FRAME_DURATION},
};
use {
    self::constants::*,
    self::registry::SessionRegistry,
    std::{
        io,
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    },
    parking_lot::{Condvar, Mutex}
};

pub mod balancer;
pub mod constants;
pub mod registry;

// ============================================================================
// Будильник воркера
// ============================================================================

/// Будит поток воркера, спящий без работы.
///
/// Флаг `signaled` закрывает классическую гонку `Condvar`: если `notify`
/// придёт между «решили спать» и «легли в `wait`», сигнал не теряется —
/// `wait` увидит флаг под мьютексом и не уснёт.
pub struct WorkerWake {
    signaled: Mutex<bool>,
    cv: Condvar,
}

impl WorkerWake {
    #[must_use]
    pub fn new() -> Self {
        Self {
            signaled: Mutex::new(false),
            cv: Condvar::new(),
        }
    }

    /// Будит воркер (или помечает, что он должен проснуться сразу).
    /// `notify_one`: у будильника ровно один ожидающий поток.
    #[inline]
    pub fn notify(&self) {
        *self.signaled.lock() = true;
        self.cv.notify_one();
    }

    /// Ждёт сигнал не дольше `timeout` и сбрасывает флаг.
    fn wait(&self, timeout: Duration) {
        let mut signaled = self.signaled.lock();

        if !*signaled {
            self.cv.wait_for(&mut signaled, timeout);
        }

        *signaled = false;
    }
}

impl Default for WorkerWake {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Общее состояние воркера
// ============================================================================

/// Состояние, которое делят `Scheduler` и его поток.
struct WorkerShared {
    /// Стабильный идентификатор воркера (не индекс: индексы сдвигаются).
    /// По нему сессия понимает, «её» ли воркер её обслуживает; при выносе
    /// владелец меняется, и прежний воркер сразу перестаёт её трогать.
    id: u64,

    /// Сессии воркера.
    registry: SessionRegistry,

    /// Поколение потока. Монотонно растёт и никогда не обнуляется: поток со
    /// старым номером при ближайшей проверке видит несовпадение и выходит.
    /// Это надёжнее флага `running`, который не различает «остановили и тут
    /// же запустили заново».
    generation: AtomicU64,

    /// Будильник простаивающего потока; клонируется в каждую сессию.
    wake: Arc<WorkerWake>,

    /// Скользящее среднее стоимости тика (подготовка + отправка), нс.
    /// Читается балансировщиком.
    cost_ns: AtomicU64,
}

/// Скользящее среднее: `old + ((sample - old) >> EMA_SHIFT)`.
///
/// `old == 0` — первое измерение: берётся как есть, иначе оно «размывалось»
/// бы нулём.
#[inline]
pub(crate) fn ema_update(old: u64, sample: u64) -> u64 {
    if old == 0 {
        return sample;
    }
    let old = old as i64;
    (old + ((sample as i64 - old) >> EMA_SHIFT)).max(0) as u64
}

impl WorkerShared {
    #[inline]
    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::Acquire) == generation
    }

    /// Единственный писатель — поток воркера, поэтому `Relaxed` достаточно.
    #[inline]
    fn record_cost(&self, cost_ns: u64) {
        let old = self.cost_ns.load(Ordering::Relaxed);
        self.cost_ns
            .store(ema_update(old, cost_ns), Ordering::Relaxed);
    }
}

// ============================================================================
// Планировщик (один воркер)
// ============================================================================

/// Воркер: поток, который раз в кадр (20 мс) отправляет пакеты своих сессий.
pub struct Scheduler {
    shared: Arc<WorkerShared>,

    /// Handle потока. `shutdown` и `spawn` меняют его через `&self`.
    thread: Mutex<Option<thread::JoinHandle<()>>>,
}

impl Scheduler {
    /// Создаёт воркер без потока: поток стартует при первой сессии.
    #[must_use]
    pub fn new(id: u64) -> Self {
        Self {
            shared: Arc::new(WorkerShared {
                id,
                registry: SessionRegistry::new(),
                generation: AtomicU64::new(0),
                wake: Arc::new(WorkerWake::new()),
                cost_ns: AtomicU64::new(0),
            }),
            thread: Mutex::new(None),
        }
    }

    #[inline]
    #[must_use]
    pub fn id(&self) -> u64 {
        self.shared.id
    }

    /// Скользящее среднее стоимости тика, нс (0 — ещё не измерялось).
    #[inline]
    #[must_use]
    pub fn cost_ns(&self) -> u64 {
        self.shared.cost_ns.load(Ordering::Relaxed)
    }

    /// Количество сессий воркера.
    #[inline]
    #[must_use]
    pub fn session_count(&self) -> usize {
        self.shared.registry.len()
    }

    /// Сессия воркера по `id`.
    #[must_use]
    pub fn session(&self, id: u32) -> Option<Arc<SocketInner>> {
        self.shared.registry.get(id)
    }

    /// Добавляет сессию. Поток воркера стартует, если ещё не запущен.
    ///
    /// Порядок: сначала `attach`, потом `registry.add`. Воркер, увидевший
    /// сессию в реестре, обязан застать корректные `owner` и `wake`.
    /// При выносе сессии новый воркер вызывает `attach` до публикации у
    /// себя, поэтому прежний сразу видит нового владельца и не отправляет
    /// пакеты дважды.
    ///
    /// # Ошибки
    /// Не удалось запустить поток; сессия убирается из реестра.
    pub fn add_session(&self, id: u32, session: Arc<SocketInner>) -> io::Result<()> {
        session.attach(self.shared.id, Arc::clone(&self.shared.wake));
        self.shared.registry.add(id, session);

        {
            let mut slot = self.thread.lock();

            // Поток мог завершиться сам (паника, `shutdown`): перезапускаем.
            if slot.as_ref().is_some_and(thread::JoinHandle::is_finished) {
                slot.take();
            }

            if slot.is_none() {
                if let Err(error) = self.spawn_worker(&mut slot) {
                    drop(slot);
                    self.shared.registry.remove(id);
                    return Err(error);
                }
            }
        }

        // Без `notify` первый пакет новой сессии ждал бы до `KEEPALIVE_SWEEP`.
        self.shared.wake.notify();
        Ok(())
    }

    /// Убирает сессию и возвращает её. Если воркер опустел, поток
    /// останавливается.
    pub fn remove_session(&self, id: u32) -> Option<Arc<SocketInner>> {
        let removed = self.shared.registry.remove(id);

        if self.shared.registry.is_empty() {
            let mut slot = self.thread.lock();

            // Повторная проверка под локом: параллельный `add_session` мог
            // успеть положить новую сессию.
            if self.shared.registry.is_empty() {
                self.shutdown_locked(&mut slot);
            }
        }

        removed
    }

    /// Останавливает поток воркера (без ожидания его завершения).
    pub fn shutdown(&self) {
        let mut slot = self.thread.lock();
        self.shutdown_locked(&mut slot);
    }

    fn shutdown_locked(&self, slot: &mut Option<thread::JoinHandle<()>>) {
        // Новое поколение: поток завершится сам на ближайшей проверке.
        self.shared.generation.fetch_add(1, Ordering::AcqRel);

        // Без `notify` спящий поток заметил бы остановку только по таймауту.
        self.shared.wake.notify();

        // `join` здесь нельзя: `shutdown` может быть вызван из самого воркера
        // (вынос сессии → `remove_session`), это дедлок. Handle просто
        // отбрасывается, поток завершается сам.
        slot.take();
    }

    fn spawn_worker(&self, slot: &mut Option<thread::JoinHandle<()>>) -> io::Result<()> {
        let my_generation = self.shared.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let shared = Arc::clone(&self.shared);

        let handle = thread::Builder::new()
            .name(format!("voice-timer-{}", shared.id))
            .spawn(move || worker_loop(shared, my_generation))?;

        *slot = Some(handle);
        Ok(())
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        // Без явного `shutdown` поток жил бы до конца процесса.
        self.shutdown();
    }
}

// ============================================================================
// Цикл воркера
// ============================================================================

/// Адаптивный запас сна: насколько раньше дедлайна воркер просыпается и
/// дальше добирает время спином.
///
/// После каждого `thread::sleep` измеряется, насколько сон проспал заказанное
/// время (`overshoot`). Нужный запас — `2·overshoot + 100 мкс` в пределах
/// `SPIN_MARGIN..=SPIN_MARGIN_MAX`. Рост мгновенный, спад плавный, чтобы одна
/// тихая секунда не возвращала воркера к «переспал».
struct SpinMargin {
    ns: u64,
}

impl SpinMargin {
    fn new() -> Self {
        Self {
            ns: SPIN_MARGIN.as_nanos() as u64,
        }
    }

    #[inline]
    fn get(&self) -> Duration {
        Duration::from_nanos(self.ns)
    }

    #[inline]
    fn observe(&mut self, overshoot: Duration) {
        let min = SPIN_MARGIN.as_nanos() as u64;
        let max = SPIN_MARGIN_MAX.as_nanos() as u64;

        let target = (overshoot.as_nanos() as u64)
            .saturating_mul(2)
            .saturating_add(100_000)
            .clamp(min, max);

        if target >= self.ns {
            self.ns = target;
        } else {
            self.ns -= (self.ns - target) >> SPIN_MARGIN_DECAY_SHIFT;
        }
    }
}

/// Спит до `deadline`: `thread::sleep` с запасом, затем спин.
///
/// Никогда не возвращается раньше `deadline`: `deadline += FRAME_DURATION`
/// предполагает, что тик не закончился раньше своего дедлайна.
#[inline]
fn sleep_until(deadline: Instant, margin: &mut SpinMargin) {
    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return;
    };

    let spin = margin.get();
    if remaining > spin {
        let requested = remaining - spin;
        let before = Instant::now();
        thread::sleep(requested);
        margin.observe(before.elapsed().saturating_sub(requested));
    }

    while Instant::now() < deadline {
        std::hint::spin_loop();
    }
}

/// Тело потока воркера.
///
/// Каждый тик состоит из фаз:
/// * A — подготовка: кадры берутся из очередей и шифруются сразу после
///   предыдущей отправки, поэтому к дедлайну остаётся только `send`;
/// * B — ожидание дедлайна (сон + спин);
/// * C — отправка подготовленных пакетов;
/// * D — расчёт следующего дедлайна (по сетке, без накопления дрейфа).
fn worker_loop(shared: Arc<WorkerShared>, my_generation: u64) {
    // Первый дедлайн — «сейчас»: первый тик сразу после старта.
    let mut deadline = Instant::now();
    let mut next_sweep = deadline;
    let mut overload_ticks = 0u32;
    let mut margin = SpinMargin::new();

    // Сессии с готовым пакетом на этом тике. Переиспользуется между
    // итерациями; `Arc` не даёт потерять сессию, удалённую из реестра
    // между подготовкой и отправкой.
    let mut prepared: Vec<Arc<SocketInner>> = Vec::new();

    while shared.is_current(my_generation) {
        // Снимок реестра: консистентный набор на этот тик.
        let snapshot = shared.registry.snapshot();

        // ---- keepalive ----------------------------------------------------
        let now = Instant::now();
        if now >= next_sweep {
            let now_us = mono_us();
            for session in snapshot.values() {
                // Снимок мог быть сделан до выноса сессии на другой воркер.
                if session.owner() == shared.id {
                    session.keepalive_if_due(now_us);
                }
            }
            next_sweep = now + KEEPALIVE_SWEEP;
        }

        // ---- Фаза A: подготовка -------------------------------------------
        let phase_a = Instant::now();
        let now_us = mono_us();

        // «Хоть одна сессия в потоке»: иначе воркер уходит спать на `wake`,
        // а не тикает вхолостую.
        let mut in_stream = false;

        // Самая дорогая по подготовке сессия — кандидат на вынос.
        let mut worst: Option<(u32, u64)> = None;

        for (&id, session) in snapshot.iter() {
            if session.owner() != shared.id {
                continue;
            }

            // Паника одной сессии не должна останавливать воркер: на нём
            // работают и другие сессии (профиль собран с `panic = "unwind"`).
            let started = Instant::now();
            let result = catch_unwind(AssertUnwindSafe(|| session.prepare(now_us)))
                .unwrap_or(Prepare::Skip);

            match result {
                Prepare::Ready => {
                    let cost = started.elapsed().as_nanos() as u64;

                    if worst.map_or(true, |(_, c)| cost > c) {
                        worst = Some((id, cost));
                    }

                    prepared.push(Arc::clone(session));
                    in_stream = true;
                }

                // Короткий провал очереди внутри потока: ритм сохраняем.
                Prepare::Empty => {
                    if session.in_stream(now_us) {
                        in_stream = true;
                    }
                }

                Prepare::Skip => {}
            }
        }
        let prepare_cost = phase_a.elapsed();

        // Снимок нужно отпустить до сна: пока он жив, он держит старую карту.
        drop(snapshot);

        // ---- Простой: ни одной сессии в потоке ----------------------------
        if !in_stream {
            // Ждём `notify` от производителя либо ближайшую проверку
            // keepalive (но не меньше 1 мс, чтобы не крутиться вхолостую).
            let timeout = next_sweep
                .saturating_duration_since(Instant::now())
                .max(Duration::from_millis(1));

            shared.wake.wait(timeout);

            // После сна старый дедлайн далеко в прошлом: начинаем с «сейчас»,
            // иначе воркер догонял бы пропущенные тики залпом.
            deadline = Instant::now();
            continue;
        }

        // ---- Фаза B: ожидание дедлайна ------------------------------------
        sleep_until(deadline, &mut margin);

        // Воркер заменён: пакеты остаются в сессиях (`pending`) и уйдут с
        // нового воркера, ничего не теряется.
        if !shared.is_current(my_generation) {
            break;
        }

        // ---- Фаза C: отправка ---------------------------------------------
        let phase_c = Instant::now();
        let now_us = mono_us();
        let prepared_count = prepared.len();

        for session in prepared.drain(..) {
            if !shared.is_current(my_generation) {
                break;
            }

            // Точность планировщика: насколько позже дедлайна реально
            // уходит пакет этой сессии (с учётом очереди отправки).
            let lateness = Instant::now().saturating_duration_since(deadline);
            session.note_lateness(lateness.as_nanos() as u64);

            let _ = catch_unwind(AssertUnwindSafe(|| session.send_prepared(now_us)));
        }

        // Стоимость тика = подготовка + отправка. Читается балансировщиком.
        shared.record_cost((prepare_cost + phase_c.elapsed()).as_nanos() as u64);

        // ---- Вынос перегруженной сессии -----------------------------------
        if shared.cost_ns.load(Ordering::Relaxed) >= OVERLOAD_THRESHOLD_NS {
            overload_ticks += 1;
        } else {
            overload_ticks = 0;
        }

        if overload_ticks >= OVERLOAD_TICKS {
            overload_ticks = 0;

            if let (Some((id, _)), true) = (worst, prepared_count > 1) {
                // Сбрасываем среднее ТОЛЬКО когда сессия реально уехала: прежняя
                // оценка включала её стоимость, и без сброса воркер выносил бы
                // по сессии каждые два тика. При неудачном выносе (занятый
                // балансировщик, сессия уже уехала) стоимость не изменилась,
                // и стирать измеренную перегрузку нельзя — балансировщик
                // счёл бы воркер свободным и досыпал бы на него сессии.
                if balancer::offload_session(shared.id, id) {
                    shared.cost_ns.store(0, Ordering::Relaxed);
                }
            }
        }

        // ---- Фаза D: следующий дедлайн ------------------------------------
        deadline += FRAME_DURATION;

        let now = Instant::now();
        if now > deadline + MAX_CATCHUP {
            // Отстали сильнее `MAX_CATCHUP`: догонять бессмысленно (пакеты
            // устарели), иначе получим лавину отправок подряд.
            deadline = now + FRAME_DURATION;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Поколение воркера растёт монотонно и не повторяется после остановки.
    #[test]
    fn generation_is_monotonic_across_shutdown_and_respawn() {
        let scheduler = Scheduler::new(1);
        let mut slot = scheduler.thread.lock();

        scheduler.spawn_worker(&mut slot).unwrap();
        let first = scheduler.shared.generation.load(Ordering::Acquire);

        scheduler.shutdown_locked(&mut slot);
        let stopped = scheduler.shared.generation.load(Ordering::Acquire);
        assert!(stopped > first, "остановка должна менять поколение, а не обнулять его");

        scheduler.spawn_worker(&mut slot).unwrap();
        let second = scheduler.shared.generation.load(Ordering::Acquire);
        assert!(second > stopped);

        scheduler.shutdown_locked(&mut slot);
    }

    /// `sleep_until` не возвращается раньше дедлайна.
    #[test]
    fn sleep_until_never_returns_early() {
        let mut margin = SpinMargin::new();
        for _ in 0..20 {
            let deadline = Instant::now() + Duration::from_millis(3);
            sleep_until(deadline, &mut margin);
            assert!(Instant::now() >= deadline);
        }
    }

    /// Дедлайн в прошлом не блокирует.
    #[test]
    fn sleep_until_past_deadline_returns_immediately() {
        let started = Instant::now();
        sleep_until(started - Duration::from_millis(5), &mut SpinMargin::new());
        assert!(started.elapsed() < Duration::from_millis(5));
    }

    /// Сигнал, посланный до `wait`, не теряется.
    #[test]
    fn wake_signal_is_not_lost() {
        let wake = WorkerWake::new();
        wake.notify();

        let started = Instant::now();
        wake.wait(Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /// Без сигнала `wait` возвращается по таймауту.
    #[test]
    fn wake_wait_times_out_without_signal() {
        let wake = WorkerWake::new();
        let started = Instant::now();
        wake.wait(Duration::from_millis(20));
        assert!(started.elapsed() >= Duration::from_millis(15));
    }

    /// Скользящее среднее сходится к постоянному входу.
    #[test]
    fn ema_converges() {
        assert_eq!(ema_update(0, 5_000), 5_000, "первое измерение берётся как есть");

        let mut value = 5_000;
        for _ in 0..300 {
            value = ema_update(value, 100_000);
        }
        assert!((95_000..=100_000).contains(&value), "{value}");
    }

    /// Запас сна растёт сразу после опоздания, но не выходит за пределы.
    #[test]
    fn spin_margin_grows_on_overshoot_and_is_capped() {
        let mut margin = SpinMargin::new();
        assert_eq!(margin.get(), SPIN_MARGIN);

        margin.observe(Duration::from_micros(400));
        assert_eq!(margin.get(), Duration::from_micros(900), "2·400 + 100 мкс");

        margin.observe(Duration::from_millis(50));
        assert_eq!(margin.get(), SPIN_MARGIN_MAX, "потолок");
    }

    /// После тихих снов запас плавно возвращается к нижней границе
    /// и не уходит ниже неё.
    #[test]
    fn spin_margin_decays_to_floor() {
        let mut margin = SpinMargin::new();
        margin.observe(Duration::from_millis(5));
        assert_eq!(margin.get(), SPIN_MARGIN_MAX);

        let mut prev = margin.get();
        for _ in 0..500 {
            margin.observe(Duration::ZERO);
            assert!(margin.get() <= prev, "запас не должен расти без опозданий");
            assert!(margin.get() >= SPIN_MARGIN);
            prev = margin.get();
        }
        assert!(margin.get() < Duration::from_micros(400), "{:?}", margin.get());
    }

    /// Воркер действительно отправляет пакеты с периодом кадра.
    #[test]
    fn worker_sends_one_packet_per_frame() {
        use std::net::UdpSocket;

        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();

        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        sender.connect(receiver.local_addr().unwrap()).unwrap();

        let session = Arc::new(SocketInner::new(sender));
        session.initialize_rtp(1, vec![9; 32]).unwrap();

        let scheduler = Scheduler::new(900);
        scheduler.add_session(1, Arc::clone(&session)).unwrap();
        session.push_many((0..10).map(|n| vec![n as u8, 1, 2]).collect());

        let mut buf = [0u8; 2048];
        let mut arrivals = Vec::new();
        for _ in 0..10 {
            receiver.recv(&mut buf).unwrap();
            arrivals.push(Instant::now());
        }
        scheduler.shutdown();

        // 10 пакетов за ~9 периодов; допуск на нагруженный CI.
        let total = arrivals[9].duration_since(arrivals[0]);
        assert!(
            total >= FRAME_DURATION * 8 && total <= FRAME_DURATION * 12,
            "9 интервалов заняли {total:?}"
        );
        assert_eq!(session.send_drops.load(Ordering::Relaxed), 0);
    }
}
