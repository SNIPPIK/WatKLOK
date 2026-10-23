use crate::structures::{
    audio::ring_buffer::RingBuffer,
    crypto::aes::VoiceRTPSocket
};
use std::{
    io::ErrorKind,
    net::UdpSocket,
    borrow::Cow,
    sync::{
        atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc
    }
};

/// Время до отправки keepalive пакета, для работы поверх NAT систем
const KEEP_ALIVE_INTERVAL: u64 = 10000;

/// Keepalive — 8 байт: LE u32 counter + 4 байта нулей.
/// Отправляется как есть, без RTP-обёртки и без шифрования.
const KEEPALIVE_SIZE: usize = 8;

/// Discovery — 74 байта: готовый UDP-пакет Discord.
/// Отправляется как есть, без RTP-обёртки и без шифрования.
const DISCOVERY_SIZE: usize = 74;

/// Готовые не-RTP пакеты, которые не шифруются и не оборачиваются в RTP.
///
/// NB: keepalive сюда НЕ входит намеренно — он отправляется из
/// `tick_alive` напрямую, минуя RingBuffer. Если когда-нибудь
/// добавите keepalive в очередь, эту константу нужно дополнить.
const RAW_BYPASS_SIZES: &[usize] = &[DISCOVERY_SIZE];

/// `true`, если фрейм отправляется сырым, без RTP-шифрования.
#[inline]
fn is_raw_bypass(frame_len: usize) -> bool {
    RAW_BYPASS_SIZES.contains(&frame_len)
}


/// Внутренние данные UDP-сокета с буфером исходящих пакетов и статистикой.
pub struct SocketInner {
    /// RTP-шифратор для аудио-фреймов.
    pub rtp: VoiceRTPSocket,

    /// Сокет UDP. В `Arc`, потому что может разделяться между клонами
    /// `UdpBuffered` (если такие есть).
    pub socket: Arc<UdpSocket>,

    /// Очередь исходящих пакетов.
    ///
    /// В очередь кладутся **pre-RTP** кадры (сырой Opus), а не
    /// зашифрованные пакеты. Это позволяет при ошибке сокета вернуть
    /// кадр в очередь через `push_up` и на следующем тике зашифровать
    /// его заново — с актуальными RTP-счётчиками. Если бы клали
    /// post-RTP, при повторной отправке ушёл бы пакет со старым
    /// sequence/timestamp, и RTP-поток на приёмнике разъехался бы.
    pub buffer: RingBuffer,

    /// Пакеты, не ушедшие в сокет: переполнение буфера при push
    /// или ошибка `socket.send`.
    pub send_drops: AtomicUsize,

    /// Время последней успешной отправки (мс). Используется
    /// для решения «пора ли отправить keepalive».
    pub last_send_ms: AtomicU64,

    /// Монотонный id keepalive-пакетов (первые 4 байта LE).
    pub keepalive_counter: AtomicU32,

    /// Подряд идущие неудачи в `tick` (backoff/reconnect).
    /// Сбрасывается в 0 при успешной отправке.
    pub consecutive_failures: AtomicU32,

    /// Пакеты, извлечённые из RingBuffer, но ещё не завершившие
    /// `socket.send()`.
    ///
    /// Нужен, чтобы внешний наблюдатель (JS) не считал очередь пустой,
    /// пока последний пакет реально не ушёл. RingBuffer может опустеть
    /// раньше, чем завершится send, и без этого счётчика можно принять
    /// решение «всё отправлено», когда один пакет ещё в полёте.
    pub in_flight: AtomicUsize
}

impl SocketInner {
    /// Кладёт один пакет в очередь.
    ///
    /// Неблокирующий путь. При полном буфере `push` возвращает пакет
    /// обратно — считаем его drop'ом.
    #[inline]
    pub fn push(&self, packet: Vec<u8>) {
        match self.buffer.push(packet) {
            Ok(()) => {}

            Err(_packet) => {
                self.send_drops.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Кладёт пачку пакетов.
    ///
    /// Неблокирующий путь. Если очередь заполнена не полностью,
    /// добавляется сколько влезло, остаток считается drop'ом.
    ///
    /// NB: `push_many` пропускает пустые пакеты (не занимают слот),
    /// но `pushed < expected` считает их как дропы. То есть если
    /// во входе были пустые пакеты, `send_drops` увеличится на их
    /// количество, хотя фактически ничего не потеряно. Пустые пакеты
    /// и так не должны попадать сюда — но если это станет проблемой,
    /// фильтруйте пустые до вызова.
    #[inline]
    pub fn push_many(&self, packets: Vec<Vec<u8>>) {
        if packets.is_empty() { return; }

        let expected = packets.len();
        let pushed = self.buffer.push_many(packets);

        if pushed < expected {
            self.send_drops.fetch_add(
                expected - pushed,
                Ordering::Relaxed,
            );
        }
    }

    /// Есть ли пакеты в очереди (ожидающие отправки).
    #[inline]
    pub fn has_pending_packets(&self) -> bool {
        !self.buffer.is_empty()
    }

    /// Циклический тик: отправка пакетов или keepalive.
    ///
    /// Вызывается менеджером (например, `CycleManager`) с текущим
    /// временем.
    ///
    /// - Если в очереди есть пакеты — отправляет их (`tick`).
    /// - Если очередь пуста — двигает RTP-таймстемп и, когда прошло
    ///   `KEEP_ALIVE_INTERVAL` с последней отправки, шлёт keepalive.
    ///
    /// RTP-таймстемп двигается даже при пустой очереди, чтобы таймлайн
    /// оставался монотонным: приёмник ожидает, что timestamp растёт
    /// непрерывно, даже если пакеты временно не идут.
    #[inline]
    pub fn auto_tick(&self, now: u64, budget: u8) {
        if self.has_pending_packets() {
            self.tick(now, budget);
        } else {
            // Пакетов нет, но timeline должна идти.
            if self.rtp.is_initialized() {
                self.rtp.advance_timestamp();
            }

            let last_ms = self.last_send_ms.load(Ordering::Relaxed);

            if now.saturating_sub(last_ms) >= KEEP_ALIVE_INTERVAL {
                self.tick_alive(now);
            }
        }
    }

    /// Отправляет до `budget` пакетов из очереди.
    ///
    /// Discovery (74 байта) уходит сырым — без RTP и без шифрования,
    /// RTP-счётчики при этом не двигаются.
    /// Всё остальное считается Opus-фреймом и шифруется в RTP.
    ///
    /// # Возврат `frame` в очередь при ошибке
    ///
    /// При ошибке `socket.send` в очередь возвращается **исходный
    /// pre-RTP** `frame`, а не `wire` (зашифрованный). На следующем
    /// тике `frame` пройдёт через `rtp.packet()` заново — с новыми
    /// sequence/timestamp. Если бы возвращали `wire`, повторная
    /// отправка пошла бы со старыми RTP-значениями, и приёмник
    /// получил бы пакет вне окна ожидания.
    #[inline]
    fn tick(&self, now: u64, budget: u8) {
        for _ in 0..budget {
            // Счётчик поднимаем ДО `pop()`: между удалением из очереди
            // и `send()` пакет всё ещё «в полёте» — внешний наблюдатель
            // не должен видеть очередь пустой.
            self.in_flight.fetch_add(1, Ordering::Relaxed);

            let Some(frame) = self.buffer.pop() else {
                self.in_flight.fetch_sub(1, Ordering::Release);
                break;
            };

            let bypass = is_raw_bypass(frame.len());

            if !bypass && !self.rtp.is_initialized() {
                // RTP ещё не готов — возвращаем кадр в очередь.
                // Ошибку `push_up` не считаем отдельным drop'ом:
                // фактически пакет не был отправлен, но и не был
                // «потерян по нашей вине» — просто подождёт инициализации.
                let _ = self.buffer.push_up(frame);
                self.in_flight.fetch_sub(1, Ordering::Release);
                return;
            }

            // `wire` — то, что реально уйдёт в сокет:
            //   - bypass: заимствуем у `frame` (без копии);
            //   - обычный Opus: `rtp.packet(&frame)` возвращает
            //     владеемый пакет.
            //
            // `frame` при этом остаётся сырым — его вернём в очередь
            // при ошибке сокета (см. doc метода).
            let wire: Cow<'_, [u8]> = if bypass {
                Cow::Borrowed(&frame[..])
            } else {
                match self.rtp.packet(&frame) {
                    Ok(packet) => Cow::Owned(packet),

                    Err(_e) => {
                        // Шифрование не удалось — `frame` дропаем.
                        // Возвращать его в очередь бессмысленно: он
                        // уже не зашифруется (ошибка либо детерминирована,
                        // либо говорит о невалидном состоянии RTP).
                        self.send_drops.fetch_add(1, Ordering::Relaxed);
                        self.consecutive_failures.fetch_add(1, Ordering::Relaxed);

                        #[cfg(debug_assertions)]
                        println!("RTP encrypt error: {}", _e);

                        self.in_flight.fetch_sub(1, Ordering::Release);
                        return;
                    }
                }
            };

            match self.socket.send(wire.as_ref()) {
                Ok(_) => {
                    self.consecutive_failures.store(0, Ordering::Relaxed);
                    self.last_send_ms.store(now, Ordering::Relaxed);
                }

                Err(_e) => {
                    self.send_drops.fetch_add(1, Ordering::Relaxed);
                    self.consecutive_failures.fetch_add(1, Ordering::Relaxed);

                    #[cfg(debug_assertions)]
                    println!("UDP send error: {}", _e);

                    // `wire` в bypass-ветке одолжил `frame` — освобождаем
                    // borrow, иначе `push_up(frame)` не скомпилируется.
                    // В обычной ветке `wire` владеемый, `drop(wire)` просто
                    // освободит память.
                    drop(wire);

                    // Возвращаем ИСХОДНЫЙ pre-RTP кадр — при повторе
                    // он зашифруется заново с актуальными RTP-счётчиками.
                    if self.buffer.push_up(frame).is_err() {
                        // Очередь переполнена даже после `pop` — пакет
                        // потерян. `send_drops` уже увеличен за ошибку
                        // сокета; второй раз не считаем, чтобы не
                        // двоить одну и ту же потерю.
                        #[cfg(debug_assertions)]
                        println!("push_up failed: queue full, packet lost");
                    }

                    // Сокет только что отвалился — второй `send` в том же
                    // тике, скорее всего, тоже упадёт. Выходим, следующий
                    // вызов менеджера попробует снова.
                    self.in_flight.fetch_sub(1, Ordering::Release);
                    return;
                }
            }

            self.in_flight.fetch_sub(1, Ordering::Release);
        }
    }

    /// Отправляет keepalive-пакет для поддержания NAT-сессии.
    ///
    /// Keepalive — это НЕ RTP: 8 сырых байт, без шифрования, без
    /// заголовка, без счётчиков `sequence`/`timestamp`/`counter`
    /// внутри `VoiceRTPSocket`. Работает даже до `initialize`.
    ///
    /// `WouldBlock` глотается молча: keepalive не критичен,
    /// следующий придёт через `KEEP_ALIVE_INTERVAL`.
    #[inline]
    fn tick_alive(&self, now: u64) {
        let count = self.keepalive_counter.fetch_add(1, Ordering::Relaxed);
        let mut pkt = [0u8; KEEPALIVE_SIZE];
        pkt[0..4].copy_from_slice(&count.to_le_bytes()); // LE, как ждёт Discord

        match self.socket.send(&pkt) {
            Ok(_) => {
                self.last_send_ms.store(now, Ordering::Relaxed);
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                // keepalive не критичен — пропускаем
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                println!("Keepalive send failed: {}", _e);
            }
        }
    }
}

/// Диагностический вывод при уничтожении (только в debug).
impl Drop for SocketInner {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        {
            use std::sync::atomic::Ordering;

            println!("====================");
            println!("UdpBufferedInner::drop");
            println!("send_drops={}", self.send_drops.load(Ordering::Relaxed));
            println!("last_send_ms={}", self.last_send_ms.load(Ordering::Relaxed));
            println!("keep_alive_counter={}", self.keepalive_counter.load(Ordering::Relaxed));
            println!("buffer_len={}", self.buffer.len());
            println!("buffer_cap={}", self.buffer.free_slots());
            println!("socket_strong={}", Arc::strong_count(&self.socket));
            println!("UdpBufferedInner dropped");
            println!("====================");
        }
    }
}