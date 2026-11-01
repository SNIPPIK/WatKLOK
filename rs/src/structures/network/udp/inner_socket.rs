//! Состояние отправки одной UDP-сессии: очередь Opus-кадров, RTP-шифрование
//! и повторная отправка. Тикает воркер планировщика (`timers::scheduler`).
//!
//! # Жизненный цикл пакета
//!
//! ```text
//! очередь ──prepare──▶ pending (готовый RTP-пакет) ──send_prepared──▶ сеть
//!                           ▲                               │
//!                           └──── не удалось: ждёт тик ─────┘
//! ```
//!
//! Пока есть `pending`-пакет, новый кадр из очереди не берётся: повторяется
//! именно готовый пакет (тот же seq/nonce), а не шифруется заново.

use crate::{
    structures::{
        audio::ring::ring_buffer::RingBuffer,
        crypto::aes::{CryptoError, VoiceRTPSocket},
        timers::scheduler::{constants::STREAM_GRACE_US, ema_update, WorkerWake}
    },
    utils::duration::{mono_us, FRAME_DURATION_US}
};
use {
    arc_swap::ArcSwapOption,
    parking_lot::Mutex,
    std::{
        net::UdpSocket,
        sync::{
            atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
            Arc
        }
    }
};

/// Ёмкость очереди Opus-кадров сессии (~20 с звука).
const QUEUE_CAPACITY: usize = 1024;

/// Если сессия ничего не отправляла столько, мкс, шлём keepalive.
const KEEP_ALIVE_INTERVAL_US: u64 = 10_000_000;

/// Размер keepalive-датаграммы: 4 байта счётчика (LE) + 4 байта нулей.
const KEEPALIVE_SIZE: usize = 8;

/// Разрыв между подготовленными кадрами, после которого считаем, что часть
/// кадров была пропущена (1.5 кадра), мкс.
const LATE_GAP_US: u64 = FRAME_DURATION_US * 3 / 2;

/// Сколько раз подряд пробуем отправить пакет в рамках одного тика.
///
/// На подключённом UDP-сокете асинхронная ICMP-ошибка (`ECONNREFUSED`,
/// `WSAECONNRESET`) приходит на *следующем* системном вызове и тут же
/// сбрасывается, так что немедленная повторная попытка проходит успешно.
const SEND_ATTEMPTS: u8 = 3;

/// На сколько тиков можно отложить пакет, не ушедший за `SEND_ATTEMPTS`
/// попыток. Дольше держать нет смысла: аудио устаревает.
const MAX_DEFERRED_TICKS: u8 = 1;

/// Возраст подготовленного пакета, после которого он считается устаревшим
/// и не отправляется (5 кадров), мкс.
const MAX_PACKET_AGE_US: u64 = FRAME_DURATION_US * 5;

/// Результат фазы подготовки (`SocketInner::prepare`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prepare {
    /// Есть готовый пакет: нужно вызвать `send_prepared`.
    Ready,

    /// Очередь пуста.
    Empty,

    /// Кадры есть, но отправить нечего (RTP не готов или ошибка шифрования).
    Skip
}

/// Подготовленный к отправке пакет.
#[derive(Default)]
struct Prepared {
    /// Готовый RTP-пакет (заголовок + шифртекст + тег + nonce).
    wire: Vec<u8>,

    /// `true`, пока `wire` ждёт отправки (в том числе повторной).
    pending: bool,

    /// Сколько тиков пакет уже отложен после неудачной отправки.
    deferred: u8,

    /// Время подготовки пакета, мкс (для отсечения устаревших).
    born_us: u64,

    /// В очереди замечен провал: следующий кадр идёт после паузы.
    saw_empty: bool
}

/// Сессия отправки: очередь, RTP и сокет.
pub struct SocketInner {
    pub rtp: VoiceRTPSocket,
    pub socket: Arc<UdpSocket>,
    pub buffer: RingBuffer,

    /// Окончательно потерянные кадры (переполнение очереди, ошибка шифрования,
    /// пакеты, не ушедшие после всех попыток).
    pub send_drops: AtomicUsize,

    /// Неудачные вызовы `send`, включая те, что восстановились повтором.
    pub udp_send_errors: AtomicUsize,

    /// Подготовленных, но ещё не отправленных пакетов (0 или 1).
    pub in_flight: AtomicUsize,

    /// Идентификатор воркера, который сейчас обслуживает сессию (0 — никакой).
    owner: AtomicU64,

    /// Будильник воркера: производитель будит его при появлении кадров.
    wake: ArcSwapOption<WorkerWake>,

    last_send_us: AtomicU64,
    keepalive_counter: AtomicU32,
    last_prepare_us: AtomicU64,

    /// Скользящее среднее опоздания отправки относительно дедлайна, нс.
    lateness_ns: AtomicU64,

    prepared: Mutex<Prepared>
}

impl SocketInner {
    pub fn new(socket: UdpSocket) -> Self {
        Self {
            rtp: VoiceRTPSocket::new(),
            socket: Arc::new(socket),
            buffer: RingBuffer::new(QUEUE_CAPACITY),
            send_drops: AtomicUsize::new(0),
            udp_send_errors: AtomicUsize::new(0),
            in_flight: AtomicUsize::new(0),
            owner: AtomicU64::new(0),
            wake: ArcSwapOption::empty(),
            // Отсчёт keepalive идёт от создания сессии, а не от 0.
            last_send_us: AtomicU64::new(mono_us()),
            keepalive_counter: AtomicU32::new(0),
            last_prepare_us: AtomicU64::new(0),
            lateness_ns: AtomicU64::new(0),
            prepared: Mutex::new(Prepared::default())
        }
    }

    // ------------------------------------------------------------------
    // Производитель
    // ------------------------------------------------------------------

    /// Кладёт кадры в очередь и будит воркер. Не поместившиеся — в `send_drops`.
    pub fn push_many(&self, packets: Vec<Vec<u8>>) {
        if packets.is_empty() {
            return;
        }

        let expected = packets.len();
        let pushed = self.buffer.push_many(packets);

        if pushed < expected {
            self.send_drops.fetch_add(expected - pushed, Ordering::Relaxed);
        }

        if pushed > 0 {
            self.notify_worker();
        }
    }

    pub fn notify_worker(&self) {
        if let Some(wake) = self.wake.load_full() {
            wake.notify();
        }
    }

    // ------------------------------------------------------------------
    // Привязка к воркеру
    // ------------------------------------------------------------------

    /// Привязывает сессию к воркеру. Сначала будильник, потом владелец:
    /// воркер, увидевший себя владельцем, застанет корректный будильник.
    pub fn attach(&self, owner: u64, wake: Arc<WorkerWake>) {
        self.wake.store(Some(wake));
        self.owner.store(owner, Ordering::Release);
    }

    #[inline]
    pub fn owner(&self) -> u64 {
        self.owner.load(Ordering::Acquire)
    }

    /// Фиксирует опоздание очередной отправки, нс (см. `lateness_ns`).
    #[inline]
    pub fn note_lateness(&self, lateness_ns: u64) {
        let old = self.lateness_ns.load(Ordering::Relaxed);
        self.lateness_ns
            .store(ema_update(old, lateness_ns), Ordering::Relaxed);
    }

    /// Скользящее среднее опоздания отправки относительно дедлайна, нс.
    ///
    /// Это и есть точность планировщика: 0 — идеально, десятки мкс — норма,
    /// сотни мкс и больше — воркер не успевает за нагрузкой или хост
    /// перегружен.
    #[inline]
    pub fn lateness_ns(&self) -> u64 {
        self.lateness_ns.load(Ordering::Relaxed)
    }

    /// `true`, если сессия недавно отправляла пакеты.
    #[inline]
    pub fn in_stream(&self, now_us: u64) -> bool {
        let last = self.last_prepare_us.load(Ordering::Relaxed);
        last != 0 && now_us.saturating_sub(last) < STREAM_GRACE_US
    }

    // ------------------------------------------------------------------
    // Фазы тика
    // ------------------------------------------------------------------

    /// Фаза A: гарантирует, что есть пакет к отправке.
    ///
    /// Если с прошлого тика остался неотправленный пакет — он имеет
    /// приоритет (повтор); иначе берётся кадр из очереди и шифруется.
    pub fn prepare(&self, now_us: u64) -> Prepare {
        let mut state = self.prepared.lock();

        if state.pending {
            if now_us.saturating_sub(state.born_us) <= MAX_PACKET_AGE_US {
                return Prepare::Ready;
            }
            // Пакет слишком стар: отправлять его бессмысленно.
            self.discard_pending(&mut state, true);
        }

        self.fill(&mut state, now_us)
    }

    /// Берёт кадр из очереди и собирает из него RTP-пакет в `state.wire`.
    fn fill(&self, state: &mut Prepared, now_us: u64) -> Prepare {
        if self.buffer.is_empty() {
            state.saw_empty = true;
            return Prepare::Empty;
        }

        if !self.rtp.is_initialized() {
            return Prepare::Skip;
        }

        let Some(frame) = self.buffer.pop() else {
            state.saw_empty = true;
            return Prepare::Empty;
        };

        // После провала в потоке сдвигаем RTP-timestamp на число
        // пропущенных кадров, чтобы получатель сохранил тайминг.
        let last = self.last_prepare_us.swap(now_us, Ordering::Relaxed);
        if std::mem::take(&mut state.saw_empty) && last != 0 {
            let gap = now_us.saturating_sub(last);

            if gap > LATE_GAP_US {
                let skipped = (gap + FRAME_DURATION_US / 2) / FRAME_DURATION_US - 1;
                self.rtp.advance_timestamp(skipped);
            }
        }

        match self.rtp.packet_into(&frame, &mut state.wire) {
            Ok(()) => {
                state.pending = true;
                state.deferred = 0;
                state.born_us = now_us;
                self.in_flight.store(1, Ordering::Relaxed);
                Prepare::Ready
            }

            Err(error) => {
                self.send_drops.fetch_add(1, Ordering::Relaxed);
                state.wire.clear();

                #[cfg(debug_assertions)]
                eprintln!("RTP packet encryption failed: {error}");
                #[cfg(not(debug_assertions))]
                let _ = error;

                Prepare::Skip
            }
        }
    }

    /// Фаза C: отправляет подготовленный пакет.
    ///
    /// Неудачная отправка повторяется сразу (до `SEND_ATTEMPTS` раз), затем
    /// пакет откладывается на следующий тик. Если пакет ушёл с задержкой в
    /// тик, следом сразу отправляется и следующий кадр — иначе поток
    /// навсегда отстал бы на кадр.
    pub fn send_prepared(&self, now_us: u64) {
        let mut state = self.prepared.lock();

        if !state.pending { return; }

        let was_deferred = state.deferred > 0;
        self.transmit(&mut state, now_us);

        if was_deferred
            && !state.pending
            && self.fill(&mut state, now_us) == Prepare::Ready
        {
            self.transmit(&mut state, now_us);
        }
    }

    /// Отправляет `state.wire`. Успех или окончательная потеря сбрасывают
    /// `pending`; иначе пакет остаётся ждать следующего тика.
    fn transmit(&self, state: &mut Prepared, now_us: u64) {
        for _ in 0..SEND_ATTEMPTS {
            match self.socket.send(&state.wire) {
                Ok(sent) if sent == state.wire.len() => {
                    self.last_send_us.store(now_us, Ordering::Relaxed);
                    self.discard_pending(state, false);
                    return;
                }

                // Для UDP частичная отправка невозможна, но если она всё же
                // случилась — пакет битый, ведём себя как при ошибке.
                Ok(_) | Err(_) => {
                    self.udp_send_errors.fetch_add(1, Ordering::Relaxed);
                }
            }
        }

        self.defer_or_drop(state);
    }

    /// Все быстрые попытки неудачны: откладывает пакет на тик либо теряет.
    fn defer_or_drop(&self, state: &mut Prepared) {
        if state.deferred < MAX_DEFERRED_TICKS {
            state.deferred += 1;
        } else {
            self.discard_pending(state, true);
        }
    }

    /// Сбрасывает подготовленный пакет; `count_drop` — считать его потерей.
    fn discard_pending(&self, state: &mut Prepared, count_drop: bool) {
        if state.pending && count_drop {
            self.send_drops.fetch_add(1, Ordering::Relaxed);
        }

        state.pending = false;
        state.deferred = 0;
        state.wire.clear();
        self.in_flight.store(0, Ordering::Relaxed);
    }

    // ------------------------------------------------------------------
    // RTP
    // ------------------------------------------------------------------

    /// Инициализирует RTP. Пакет, подготовленный со старым ключом, после
    /// успешной переинициализации не должен отправляться.
    pub fn initialize_rtp(&self, ssrc: u32, key: Vec<u8>) -> Result<(), CryptoError> {
        let mut state = self.prepared.lock();

        // При ошибке нового ключа старое состояние не меняем.
        self.rtp.initialize(ssrc, key)?;

        self.discard_pending(&mut state, true);
        drop(state);

        self.notify_worker();
        Ok(())
    }

    /// Уничтожает RTP-состояние и удаляет потенциально устаревший пакет.
    pub fn destroy_rtp(&self) {
        let mut state = self.prepared.lock();

        self.discard_pending(&mut state, false);
        self.rtp.destroy();
    }

    // ------------------------------------------------------------------
    // Keepalive
    // ------------------------------------------------------------------

    /// Шлёт keepalive, если сессия давно ничего не отправляла.
    pub fn keepalive_if_due(&self, now_us: u64) {
        let last = self.last_send_us.load(Ordering::Relaxed);

        if now_us.saturating_sub(last) >= KEEP_ALIVE_INTERVAL_US {
            self.send_keepalive(now_us);
        }
    }

    fn send_keepalive(&self, now_us: u64) {
        let count = self.keepalive_counter.fetch_add(1, Ordering::Relaxed);
        let mut packet = [0u8; KEEPALIVE_SIZE];
        packet[..4].copy_from_slice(&count.to_le_bytes());

        // При ошибке `last_send_us` не обновляется: следующая проверка
        // (через `KEEPALIVE_SWEEP`) попробует снова.
        if self.socket.send(&packet).is_ok() {
            self.last_send_us.store(now_us, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const T0: u64 = 1_000_000;

    /// Сессия, подключённая к локальному приёмнику, с готовым RTP.
    fn session() -> (SocketInner, UdpSocket) {
        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();

        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        sender.connect(receiver.local_addr().unwrap()).unwrap();

        let inner = SocketInner::new(sender);
        inner.initialize_rtp(1, vec![7; 32]).unwrap();
        (inner, receiver)
    }

    fn frame(n: u8) -> Vec<Vec<u8>> {
        vec![vec![n, n, n]]
    }

    /// Симулирует тик, в котором все попытки отправки провалились.
    fn fail_tick(inner: &SocketInner) {
        let mut state = inner.prepared.lock();
        inner.defer_or_drop(&mut state);
    }

    /// Нормальный путь: пакет уходит, состояние очищается.
    #[test]
    fn prepared_packet_is_sent_and_state_cleared() {
        let (inner, receiver) = session();
        inner.push_many(frame(1));

        assert_eq!(inner.prepare(T0), Prepare::Ready);
        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 1);

        inner.send_prepared(T0);

        let mut buf = [0u8; 2048];
        let size = receiver.recv(&mut buf).unwrap();
        // RTP-заголовок 12 + payload 3 + тег 16 + nonce 4.
        assert_eq!(size, 12 + 3 + 16 + 4);

        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 0);
        assert_eq!(inner.prepare(T0 + FRAME_DURATION_US), Prepare::Empty);
    }

    /// Регрессия: после неудачной отправки пакет обязан уйти на следующем
    /// тике. Раньше `prepare` возвращал для него `Pending`, воркер такой
    /// результат не отправлял, и сессия навсегда переставала слать звук.
    #[test]
    fn failed_packet_is_resent_on_next_tick() {
        let (inner, receiver) = session();
        inner.push_many(frame(1));

        assert_eq!(inner.prepare(T0), Prepare::Ready);
        let wire = inner.prepared.lock().wire.clone();

        fail_tick(&inner);
        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 1);

        let next = T0 + FRAME_DURATION_US;
        assert_eq!(inner.prepare(next), Prepare::Ready);
        inner.send_prepared(next);

        // Ушёл тот же самый пакет (тот же seq и nonce).
        let mut buf = [0u8; 2048];
        let size = receiver.recv(&mut buf).unwrap();
        assert_eq!(&buf[..size], wire.as_slice());

        assert_eq!(inner.send_drops.load(Ordering::Relaxed), 0);
        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 0);
    }

    /// Отложенный пакет не сдвигает очередь: после его отправки сразу
    /// уходит и следующий кадр.
    #[test]
    fn deferred_packet_is_followed_by_next_frame() {
        let (inner, receiver) = session();
        inner.push_many(vec![vec![1, 1, 1], vec![2, 2, 2]]);

        assert_eq!(inner.prepare(T0), Prepare::Ready);
        fail_tick(&inner);

        let next = T0 + FRAME_DURATION_US;
        assert_eq!(inner.prepare(next), Prepare::Ready);
        inner.send_prepared(next);

        let mut buf = [0u8; 2048];
        receiver.recv(&mut buf).unwrap();
        receiver.recv(&mut buf).unwrap();

        assert_eq!(inner.buffer.len(), 0);
        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 0);
    }

    /// Пакет, не ушедший и после отложенного тика, теряется (и считается).
    #[test]
    fn packet_is_dropped_after_deferral_is_exhausted() {
        let (inner, _receiver) = session();
        inner.push_many(frame(1));
        assert_eq!(inner.prepare(T0), Prepare::Ready);

        fail_tick(&inner);
        assert_eq!(inner.send_drops.load(Ordering::Relaxed), 0);

        fail_tick(&inner);
        assert_eq!(inner.send_drops.load(Ordering::Relaxed), 1);
        assert_eq!(inner.in_flight.load(Ordering::Relaxed), 0);
        assert_eq!(inner.prepare(T0 + FRAME_DURATION_US), Prepare::Empty);
    }

    /// Устаревший отложенный пакет не отправляется: вместо него берётся
    /// свежий кадр.
    #[test]
    fn stale_pending_packet_is_replaced_by_fresh_frame() {
        let (inner, _receiver) = session();
        inner.push_many(vec![vec![1, 1, 1], vec![2, 2, 2]]);

        assert_eq!(inner.prepare(T0), Prepare::Ready);
        let stale = inner.prepared.lock().wire.clone();
        fail_tick(&inner);

        assert_eq!(inner.prepare(T0 + MAX_PACKET_AGE_US + 1), Prepare::Ready);
        assert_ne!(inner.prepared.lock().wire, stale);
        assert_eq!(inner.send_drops.load(Ordering::Relaxed), 1);
    }

    /// Кадры не берутся из очереди, пока RTP не инициализирован.
    #[test]
    fn frames_stay_queued_until_rtp_is_ready() {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let inner = SocketInner::new(socket);
        inner.push_many(frame(1));

        assert_eq!(inner.prepare(T0), Prepare::Skip);
        assert_eq!(inner.buffer.len(), 1);
    }

    /// Переполнение очереди считается потерей.
    #[test]
    fn queue_overflow_is_counted_as_drop() {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let inner = SocketInner::new(socket);

        let batch: Vec<Vec<u8>> = (0..QUEUE_CAPACITY + 5).map(|_| vec![1u8]).collect();
        inner.push_many(batch);

        assert_eq!(inner.buffer.len(), QUEUE_CAPACITY);
        assert_eq!(inner.send_drops.load(Ordering::Relaxed), 5);
    }

    /// Keepalive уходит только после долгого молчания.
    #[test]
    fn keepalive_is_sent_only_after_idle_interval() {
        let (inner, receiver) = session();
        receiver
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let now = mono_us();
        inner.last_send_us.store(now, Ordering::Relaxed);

        inner.keepalive_if_due(now + 1_000);
        let mut buf = [0u8; 16];
        assert!(receiver.recv(&mut buf).is_err(), "рано для keepalive");

        inner.keepalive_if_due(now + KEEP_ALIVE_INTERVAL_US);
        assert_eq!(receiver.recv(&mut buf).unwrap(), KEEPALIVE_SIZE);
    }
}
