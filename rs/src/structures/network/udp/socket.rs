use crate::structures::{
    audio::ring_buffer::RingBuffer,
    crypto::aes::VoiceRTPSocket,
    network::udp::inner_socket::SocketInner,
    timers::scheduler::balancer::{add_global_session, remove_global_session},
};
use parking_lot::Mutex;
use std::{
    fmt,
    io::ErrorKind,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

/// Счётчик идентификаторов сессий в глобальном планировщике.
///
/// Начинается с 1: `0` — удобное «нулевое» значение для отладки
/// (например, «сессия не зарегистрирована»). Переполнение через
/// `fetch_add` — не проблема: к моменту оборота старые id давно
/// не используются.
static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);

/// Ошибка UDP-сокета (создание сокета, инициализация RTP, запуск планировщика).
///
/// Хранит только текст: источники ошибок разнородны (`io::Error`, AES),
/// а вызывающему нужно лишь сообщение для лога или `Close`-события.
#[derive(Debug, Clone)]
pub struct SocketError(String);

impl SocketError {
    // Приватный: снаружи ошибку создают только методы этого модуля.
    // `impl Into<String>` — чтобы принимать и `&str`, и `String`.
    fn new(reason: impl Into<String>) -> Self {
        Self(reason.into())
    }
}

// `Display` — просто текст. `write_str` дешевле `write!`, форматирования нет.
impl fmt::Display for SocketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// `Error` — пустая реализация. Даёт `?` и совместимость с `Box<dyn Error>`.
impl std::error::Error for SocketError {}

/// Владелец UDP-сессии: сокет, поток приёма и регистрация в планировщике.
///
/// # Разделение ответственности
///
/// * `SocketBuffered` — **единственный владелец**. Он **не `Clone`**:
///   это гарантирует, что освобождение ресурсов (поток приёма, запись
///   в планировщике, ключ RTP) произойдёт ровно один раз, в одном
///   месте. Клонирование владельца означало бы разделение
///   ответственности за `destroy`, и рано или поздно кто-то забыл бы
///   вызвать `join` или снять регистрацию.
///
/// * `SocketInner` — общее состояние (буфер, RTP, сокет). Планировщик
///   держит только `Arc<SocketInner>` и тикает его. Это разрывает
///   потенциальный цикл: планировщик → `SocketInner` → ... → планировщик.
///   А главное — потеря последней ссылки в потоке тика **не может**
///   ни уничтожить сессию, ни заблокировать поток (если бы планировщик
///   держал `Arc<SocketBuffered>` и `SocketBuffered::Drop` дёргал бы
///   `remove_global_session`, мы бы ждали `join` сами себя).
pub struct SocketBuffered {
    inner: Arc<SocketInner>,

    /// Флаг активности потока приёма. Общий с самим потоком.
    ///
    /// `AtomicBool` — потому что `stop_listening` выставляет `false`
    /// из другого потока, а поток приёма проверяет его в цикле.
    /// `SeqCst` при `swap(true)` в `start_listening` исключает гонку
    /// двух параллельных запусков: только один увидит `false` и
    /// создаст поток.
    listener_active: Arc<AtomicBool>,

    /// Handle потока приёма.
    ///
    /// `Mutex`, чтобы `destroy`/`stop_listening` могли работать через
    /// `&self` (методы `Drop` и публичного API используют `&self`).
    /// `Option` — потому что `JoinHandle` можно забрать (`take`) ровно
    /// один раз; после `join` поле остаётся `None`, и повторный `join`
    /// не пытается присоединиться к уже присоединённому.
    listener_handle: Mutex<Option<thread::JoinHandle<()>>>,

    /// `true` после `destroy`: освобождение выполняется ровно один раз.
    ///
    /// `swap(true)` гарантирует идемпотентность даже при вызове из
    /// нескольких потоков. `Drop` вызывает `destroy` повторно — второй
    /// вызов увидит `true` и сразу выйдет.
    destroyed: AtomicBool,

    /// Идентификатор в глобальном планировщике.
    ///
    /// Нужен, чтобы снять регистрацию при `destroy`. Присваивается
    /// из `NEXT_SESSION_ID` и не меняется до конца жизни сессии.
    id: u32
}

impl SocketBuffered {
    /// Создаёт UDP-сокет, подключённый к `remote_addr`, и регистрирует
    /// сессию в планировщике.
    ///
    /// # Ошибки
    /// Не удалось создать/подключить сокет или запустить поток планировщика.
    pub fn new(remote_addr: String) -> Result<Self, SocketError> {
        // `bind("0.0.0.0:0")` — эфемерный локальный порт. `connect`
        // фиксирует удалённый адрес: дальнейшие `send`/`recv` работают
        // только с ним, и ядро не требует передавать адрес каждый раз.
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| SocketError::new(format!("Bind error: {}", e)))?;
        socket
            .connect(&remote_addr)
            .map_err(|e| SocketError::new(format!("Connect error: {}", e)))?;

        // Таймаут чтения нужен, чтобы поток приёма просыпался и видел
        // флаг остановки. Без него `recv` висел бы вечно, и `stop_listening`
        // не смог бы дождаться завершения. 20 мс — компромисс: не жжёт CPU
        // и не задерживает остановку надолго.
        socket
            .set_read_timeout(Some(Duration::from_millis(20)))
            .map_err(|e| SocketError::new(format!("Read timeout error: {}", e)))?;

        let inner = Arc::new(SocketInner {
            rtp: VoiceRTPSocket::new(),
            socket: Arc::new(socket),
            // 1024 слота — достаточно для сглаживания отправки.
            // Степень двойки: `RingBuffer` использует маску вместо `%`.
            buffer: RingBuffer::new(1024),
            send_drops: AtomicUsize::new(0),
            last_send_ms: AtomicU64::new(0),
            keepalive_counter: AtomicU32::new(0),
            consecutive_failures: AtomicU32::new(0),
            in_flight: AtomicUsize::new(0)
        });

        let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);

        // Регистрируем только `Arc<SocketInner>`; если планировщик не
        // запустился, владелец не создаётся, и ничего не остаётся висеть:
        // `inner` будет дропнут на выходе из функции, а вместе с ним
        // и сокет, и буфер.
        //
        // Порядок важен: `id` берётся ДО регистрации, чтобы `destroy`
        // мог снять правильную запись. Если бы регистрировали с одним id,
        // а хранили другой — `remove_global_session` промахнулся бы.
        add_global_session(id, Arc::clone(&inner))
            .map_err(|e| SocketError::new(format!("Scheduler error: {}", e)))?;

        Ok(Self {
            inner,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Mutex::new(None),
            destroyed: AtomicBool::new(false),
            id,
        })
    }

    /// Ставит пакеты в очередь отправки. Пустые пакеты отбрасываются.
    ///
    /// Не блокирует вызывающий поток: при переполнении очереди лишние
    /// пакеты считаются потерянными (`drops`).
    ///
    /// Фильтрация пустых — на этой стороне, до `push_many`. Причина:
    /// `RingBuffer::push_many` пропускает пустые пакеты, но не считает
    /// их в возвращаемом `written`. В `SocketInner::push_many`
    /// `expected - pushed` попал бы в `send_drops` как «потеря»,
    /// хотя фактически ничего не потеряно. Отфильтровав здесь, мы
    /// получаем корректную метрику.
    pub fn push_packets(&self, packets: Vec<Vec<u8>>) {
        if packets.is_empty() || self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let packets = packets
            .into_iter()
            .filter(|packet| !packet.is_empty())
            .collect::<Vec<_>>();

        // После фильтрации `packets` может оказаться пустым — `push_many`
        // в `SocketInner` это обработает (ранний выход).
        self.inner.push_many(packets);
    }

    /// Инициализирует RTP (SSRC и ключ AES-GCM). Ключ зануляется внутри.
    ///
    /// # Ошибки
    /// Неверная длина ключа или ошибка AES-GCM.
    #[inline]
    pub fn initialize_rtp(&self, ssrc: u32, key: Vec<u8>) -> Result<(), SocketError> {
        self.inner
            .rtp
            .initialize(ssrc, key)
            .map_err(|e| SocketError::new(e.to_string()))
    }

    /// Пакеты, ещё не ушедшие в сокет: в очереди и «в полёте».
    ///
    /// `in_flight` — пакеты, извлечённые из `RingBuffer`, но ещё не
    /// завершившие `socket.send()`. Без них счётчик мог бы показать
    /// 0, пока последний пакет реально в полёте: `RingBuffer` опустел,
    /// но `send` ещё не вернулся.
    ///
    /// `saturating_add` и `.min(u32::MAX)` — защита от переполнения
    /// при преобразовании в `u32` для JS. `usize` может быть больше
    /// `u32::MAX`, но на практике очередь ограничена `capacity`,
    /// а `in_flight` — `budget` на тик. Так что в реальности до
    /// потолка не доходит, но это дешёвая страховка.
    #[inline]
    pub fn packets(&self) -> u32 {
        let queued = self.inner.buffer.len();
        let in_flight = self.inner.in_flight.load(Ordering::Acquire);
        queued.saturating_add(in_flight).min(u32::MAX as usize) as u32
    }

    /// Количество потерянных пакетов (не отправлены или отброшены очередью).
    ///
    /// Накапливается в `send_drops`, обнуляется в `destroy`.
    #[inline]
    pub fn drops(&self) -> u32 {
        self.inner.send_drops.load(Ordering::Relaxed) as u32
    }

    /// Ставит в очередь discovery-пакет Discord (74 байта: тип 1, длина 70, SSRC).
    ///
    /// Формат: 2 байта BE — тип (1), 2 байта BE — длина (70),
    /// 4 байта BE — SSRC. Итого 8 байт заголовка + 66 байт тела.
    /// Идёт через `push` и попадает в общий поток отправки.
    pub fn discovery(&self, ssrc: u32) {
        // Создаём буфер фиксированного размера (74 байта), заполненный нулями.
        let mut packet = vec![0u8; 74];

        // Записываем тип пакета: 1 (2 байта, big-endian).
        packet[0..2].copy_from_slice(&1u16.to_be_bytes());

        // Длина пакета: 70 (2 байта, big-endian).
        packet[2..4].copy_from_slice(&70u16.to_be_bytes());

        // SSRC: 4 байта, big-endian.
        packet[4..8].copy_from_slice(&ssrc.to_be_bytes());

        // Возвращаем вектор, содержащий единственный Buffer.
        self.inner.push(packet);
    }

    /// Запускает поток приёма: каждый принятый пакет передаётся в `on_packet`
    /// прямо в этом потоке. Повторный вызов при активном потоке — no-op.
    ///
    /// `on_packet` не должен вызывать `destroy`/`stop_listening` этой же
    /// сессии синхронно (поток ждал бы сам себя; такой вызов безопасно
    /// пропускает `join`, но поток закончит работу только после возврата).
    ///
    /// `swap(true)` на `listener_active` — защита от параллельного
    /// `start_listening` из двух потоков: только один увидит `false`
    /// и создаст поток. Второй сразу выйдет.
    pub fn start_listening<F>(&self, on_packet: F) where
        F: Fn(&[u8]) + Send + 'static,
    {
        // Если сокет был уничтожен
        if self.destroyed.load(Ordering::Acquire) { return; }
        
        // Если слушатель подключения не активен
        if self.listener_active.swap(true, Ordering::SeqCst) { return; }

        // Клонируем сокет и флаг активности для передачи в поток.
        let socket = self.inner.socket.clone();
        let active = self.listener_active.clone();

        let handle = thread::Builder::new()
            .name("UDPReceive".into())
            .spawn(move || {
                // 2048 байт — с запасом больше максимального UDP-пакета
                // в голосовом канале Discord (опус ~1275 + RTP-заголовок,
                // так что 1500 хватило бы, но 2048 — привычное «с запасом»).
                let mut buf = [0u8; 2048];

                // Проверка `active` дважды: до `recv` (чтобы не блокироваться
                // после `stop_listening`) и после получения пакета
                // (чтобы не вызвать `on_packet` после остановки).
                while active.load(Ordering::Acquire) {
                    match socket.recv(&mut buf) {
                        Ok(size) if size > 0 => {
                            if !active.load(Ordering::Acquire) {
                                break;
                            }
                            on_packet(&buf[..size]);
                        }
                        // `WouldBlock` в блокирующем сокете не появится,
                        // но `TimedOut` — это штатный выход из `recv`
                        // при чтении с таймаутом. Оба означают «пока
                        // ничего не пришло» — проверяем флаг и продолжаем.
                        Err(ref e)
                        if e.kind() == ErrorKind::WouldBlock
                            || e.kind() == ErrorKind::TimedOut =>
                            {
                                continue;
                            }
                        // Прочие ошибки — фатальны для потока: сокет
                        // сломан или закрыт. Выходим; `destroy` и так
                        // выставит `active=false`.
                        Err(_) => break,
                        _ => {}
                    }
                }
            });

        match handle {
            Ok(handle) => *self.listener_handle.lock() = Some(handle),
            // Не удалось запустить поток — снимаем флаг, чтобы следующий
            // вызов мог попробовать снова. Состояние «активен, но потока
            // нет» было бы хуже.
            Err(_) => self.listener_active.store(false, Ordering::Release),
        }
    }

    /// Останавливает поток приёма и дожидается его завершения.
    ///
    /// `join` пропускается, если вызов идёт из самого потока приёма:
    /// иначе был бы дедлок (поток ждал бы сам себя). В этом случае
    /// поток сам выйдет из цикла, как только вернётся из `on_packet`.
    pub fn stop_listening(&self) {
        // Сбрасываем флаг активности, чтобы поток вышел из цикла.
        self.listener_active.store(false, Ordering::Release);

        let handle = self.listener_handle.lock().take();
        if let Some(handle) = handle {
            // Сравнение id потоков — единственный надёжный способ
            // проверить «я в этом потоке?». `Handle` из `std::thread`
            // не реализует сравнение на равенство.
            if handle.thread().id() != thread::current().id() {
                let _ = handle.join();
            }
        }
    }

    /// Освобождает сессию (идемпотентно): останавливает поток приёма,
    /// снимает регистрацию в планировщике и зануляет ключ RTP.
    ///
    /// # Порядок действий
    ///
    /// 1. `swap(true)` — защита от повторного вызова. Устанавливаем
    ///    флаг **до** `stop_listening`, чтобы поток приёма,
    ///    если он сейчас в `on_packet`, увидел «уже уничтожен»
    ///    при следующей итерации.
    /// 2. `stop_listening` — дожидаемся завершения потока. После
    ///    этого никто не дёрнет `on_packet` и не будет читать из сокета.
    /// 3. Обнуляем `send_drops` — сессия мертва, статистика
    ///    больше не нужна.
    /// 4. `remove_global_session` — снимаем регистрацию. Планировщик
    ///    больше не тикает сессию.
    /// 5. `rtp.destroy()` — зануляем ключ AES-GCM. Даже если `Arc<SocketInner>`
    ///    ещё где-то жив (например, планировщик уже взял снимок), ключ
    ///    уничтожен, и шифровать/расшифровывать этим RTP больше нельзя.
    pub fn destroy(&self) {
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        // Останавливаем фоновый поток приёма пакетов (если он был запущен).
        self.stop_listening();

        // Сбрасываем счётчик отброшенных пакетов (для статистики).
        self.inner.send_drops.store(0, Ordering::Relaxed);

        // После этого планировщик не получает новых снимков с сессией; уже
        // взятый снимок доживёт до конца своего тика, а буфер освободится
        // вместе с последним `Arc<SocketInner>` (`Drop` у `RingBuffer`).
        remove_global_session(self.id);

        self.inner.rtp.destroy();
    }
}

impl Drop for SocketBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}