use crate::structures::{
    network::udp::inner_socket::SocketInner,
    timers::scheduler::balancer::{add_global_session, remove_global_session},
};
use {
    parking_lot::Mutex,
    std::{
        fmt,
        io::{self, ErrorKind},
        net::{ToSocketAddrs, UdpSocket},
        sync::{
            atomic::{AtomicBool, AtomicU32, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    }
};

/// Счётчик идентификаторов сессий в глобальном планировщике.
static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);

/// Таймаут чтения: определяет, как быстро поток приёма замечает остановку.
const READ_TIMEOUT: Duration = Duration::from_millis(20);

/// Таймаут записи. Блокирующий `send` на переполненном буфере сокета иначе
/// мог бы заблокировать поток воркера, а с ним и все сессии на нём.
const SEND_TIMEOUT: Duration = Duration::from_millis(1);

/// Ошибка UDP-сокета.
#[derive(Debug, Clone)]
pub struct SocketError(String);

impl SocketError {
    fn new(reason: impl Into<String>) -> Self {
        Self(reason.into())
    }
}

impl fmt::Display for SocketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SocketError {}

/// Владелец UDP-сессии.
///
/// Отвечает за время жизни сессии, поток приёма и регистрацию в глобальном
/// планировщике. Само состояние отправки находится в `SocketInner`.
pub struct SocketBuffered {
    inner: Arc<SocketInner>,
    listener_active: Arc<AtomicBool>,
    listener_handle: Mutex<Option<thread::JoinHandle<()>>>,
    destroyed: AtomicBool,

    /// Идентификатор сессии в глобальном планировщике.
    id: u32,
}

impl SocketBuffered {
    /// Создаёт UDP-сокет и регистрирует сессию в планировщике.
    pub fn new(remote_addr: String) -> Result<Self, SocketError> {
        let remote = remote_addr
            .to_socket_addrs()
            .map_err(|e| SocketError::new(format!("Address error: {e}")))?
            .next()
            .ok_or_else(|| SocketError::new(format!("Address error: `{remote_addr}` not resolved")))?;

        // Локальный адрес того же семейства, что и удалённый.
        let local = if remote.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };

        let socket = UdpSocket::bind(local)
            .map_err(|e| SocketError::new(format!("Bind error: {e}")))?;

        socket
            .connect(remote)
            .map_err(|e| SocketError::new(format!("Connect error: {e}")))?;

        socket
            .set_read_timeout(Some(READ_TIMEOUT))
            .map_err(|e| SocketError::new(format!("Read timeout error: {e}")))?;

        socket
            .set_write_timeout(Some(SEND_TIMEOUT))
            .map_err(|e| SocketError::new(format!("Write timeout error: {e}")))?;

        let inner = Arc::new(SocketInner::new(socket));
        let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);

        add_global_session(id, Arc::clone(&inner))
            .map_err(|e| SocketError::new(format!("Scheduler error: {e}")))?;

        Ok(Self {
            inner,
            id,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Mutex::new(None),
            destroyed: AtomicBool::new(false),
        })
    }

    /// Добавляет Opus-кадры в очередь отправки.
    ///
    /// Пустые кадры игнорируются. Если очередь переполнена, не поместившиеся
    /// кадры попадают в `drops()`.
    pub fn push_packets(&self, mut packets: Vec<Vec<u8>>) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        packets.retain(|packet| !packet.is_empty());
        self.inner.push_many(packets);
    }

    /// Инициализирует RTP с полученными SSRC и AES-256-GCM ключом.
    pub fn initialize_rtp(&self, ssrc: u32, key: Vec<u8>) -> Result<(), SocketError> {
        self.inner
            .initialize_rtp(ssrc, key)
            .map_err(|e| SocketError::new(e.to_string()))
    }

    /// Количество кадров в очереди и в полёте.
    pub fn packets(&self) -> u32 {
        let queued = self.inner.buffer.len();
        let in_flight = self.inner.in_flight.load(Ordering::Relaxed);

        queued.saturating_add(in_flight).min(u32::MAX as usize) as u32
    }

    /// Количество окончательно потерянных кадров: переполнение очереди,
    /// ошибки шифрования и пакеты, не ушедшие после всех попыток.
    pub fn drops(&self) -> u32 {
        self.inner
            .send_drops
            .load(Ordering::Relaxed)
            .min(u32::MAX as usize) as u32
    }

    /// Количество неудачных системных вызовов `send`. Не равно числу потерь:
    /// часть ошибок восстанавливается повторной отправкой того же пакета.
    pub fn udp_send_errors(&self) -> u32 {
        self.inner
            .udp_send_errors
            .load(Ordering::Relaxed)
            .min(u32::MAX as usize) as u32
    }

    /// Среднее опоздание отправки относительно расписания, мкс.
    pub fn send_lateness_us(&self) -> u32 {
        (self.inner.lateness_ns() / 1_000).min(u64::from(u32::MAX)) as u32
    }

    /// Отправляет discovery-пакет Discord.
    ///
    /// Формат: тип 1, длина 70, SSRC и 66 байт заполнения.
    pub fn discovery(&self, ssrc: u32) -> io::Result<()> {
        if self.destroyed.load(Ordering::Acquire) {
            return Ok(());
        }

        let mut packet = [0u8; 74];

        packet[0..2].copy_from_slice(&1u16.to_be_bytes());
        packet[2..4].copy_from_slice(&70u16.to_be_bytes());
        packet[4..8].copy_from_slice(&ssrc.to_be_bytes());

        self.inner.socket.send(&packet).map(|_| ())
    }

    /// Запускает поток приёма UDP-пакетов. Обработчик вызывается из него.
    pub fn start_listening<F>(&self, on_packet: F)
    where
        F: Fn(&[u8]) + Send + 'static,
    {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        if self.listener_active.swap(true, Ordering::SeqCst) {
            return;
        }

        let socket = Arc::clone(&self.inner.socket);
        let active = Arc::clone(&self.listener_active);

        let handle = thread::Builder::new()
            .name("UDPReceive".into())
            .spawn(move || {
                let mut buf = [0u8; 2048];

                while active.load(Ordering::Acquire) {
                    match socket.recv(&mut buf) {
                        Ok(size) if size > 0 => on_packet(&buf[..size]),
                        Ok(_) => {}

                        // Таймаут и «транзитные» ошибки не должны убивать
                        // поток приёма: ICMP «port unreachable» приходит на
                        // подключённый UDP-сокет как `ConnectionRefused`
                        // (Linux) / `ConnectionReset` (Windows) и касается
                        // одного пакета, а не всего соединения.
                        Err(e)
                            if matches!(
                                e.kind(),
                                ErrorKind::WouldBlock
                                    | ErrorKind::TimedOut
                                    | ErrorKind::Interrupted
                                    | ErrorKind::ConnectionRefused
                                    | ErrorKind::ConnectionReset
                            ) => {}

                        Err(_) => break,
                    }
                }

                // Поток завершился сам: позволяем запустить приём заново.
                active.store(false, Ordering::Release);
            });

        match handle {
            Ok(handle) => *self.listener_handle.lock() = Some(handle),
            Err(_) => self.listener_active.store(false, Ordering::Release),
        }
    }

    /// Останавливает поток приёма и дожидается его завершения.
    pub fn stop_listening(&self) {
        self.listener_active.store(false, Ordering::Release);

        let handle = self.listener_handle.lock().take();

        if let Some(handle) = handle {
            // Из самого потока приёма join невозможен (дедлок).
            if handle.thread().id() != thread::current().id() {
                let _ = handle.join();
            }
        }
    }

    /// Уничтожает UDP-сессию. Идемпотентна.
    pub fn destroy(&self) {
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        self.stop_listening();
        remove_global_session(self.id);

        // Удаляем неотправленный пакет и ключ шифрования.
        self.inner.destroy_rtp();
    }
}

impl Drop for SocketBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}
