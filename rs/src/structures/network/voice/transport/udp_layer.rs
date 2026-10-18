//! Порт `UDPLayer` + `VoiceUDPSocket`: discovery-рукопожатие и отправка пакетов.

use crate::structures::network::{udp::socket::SocketBuffered, ws::runtime};
use parking_lot::Mutex;
use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    sync::oneshot,
    task::JoinHandle,
    time::{sleep, sleep_until, Instant},
};

/// Максимальное количество отправок discovery.
///
/// 5 попыток с паузой 75 мс дают окно ~300 мс на отправку, после чего
/// ждём ответ до общего таймаута. Это компромисс: больше попыток —
/// дольше ждать при полной недоступности сервера; меньше — выше шанс
/// не пробиться при кратковременных потерях.
const MAX_RETRIES: u32 = 5;

/// Пауза между отправками discovery.
///
/// 75 мс — достаточно, чтобы дать сети доставить пакет, но не настолько
/// много, чтобы растянуть попытки на секунды. Значение подобрано так,
/// чтобы 5 попыток укладывались в ~300 мс — заметно меньше общего
/// таймаута в 2 с.
const RETRY_DELAY: Duration = Duration::from_millis(75);

/// Общий таймаут ожидания ответа discovery.
///
/// Отсчитывается с момента запуска задачи, а не с последней попытки:
/// даже если все попытки ушли за 300 мс, ждём ответ до конца окна.
/// 2 секунды — баланс между «успеет прийти ответ» и «не задерживать
/// подключение при полностью мёртвом сервере».
const DISCOVERY_TIMEOUT: Duration = Duration::from_millis(2_000);

/// Статус UDP: не подключён.
const STATUS_DISCONNECTED: u8 = 0;
/// Статус UDP: идёт discovery или установка соединения.
const STATUS_CONNECTING: u8 = 1;
/// Статус UDP: соединение установлено, можно отправлять пакеты.
const STATUS_CONNECTED: u8 = 2;

/// Адрес и порт, полученные через discovery.
///
/// Это результат успешного рукопожатия: по нему понятно, куда
/// отправлять голосовые пакеты.
#[derive(Clone, Debug)]
pub struct Handshake {
    /// IPv4-адрес голосового сервера (в виде строки).
    pub address: String,

    /// UDP-порт для отправки пакетов.
    pub port: u16
}

/// Результат discovery: рукопожатие или текст ошибки.
pub type DiscoveryResult = Result<Handshake, String>;

/// Состояние, общее для слоя, потока приёма и задачи discovery.
///
/// Лежит в `Arc`: на него смотрят три места — сам `UdpLayer` (через
/// `Client`), поток приёма (через замыкание) и задача discovery.
struct Shared {
    /// Нативный сокет. `Option`, чтобы забрать его при уничтожении.
    ///
    /// ВАЖНО: `SocketBuffered` нельзя клонировать «на время» — `Drop`
    /// клона уничтожит общую сессию, поэтому все обращения идут через
    /// этот мьютекс.
    socket: Mutex<Option<SocketBuffered>>,

    /// Текущий статус: `DISCONNECTED`, `CONNECTING` или `CONNECTED`.
    /// Читается из JS-геттеров, пишется при переходе состояний.
    status: AtomicU8,

    /// Канал для отправки результата discovery во внешний `oneshot`.
    ///
    /// `Option`, потому что забрать его можно только один раз:
    /// либо discovery завершился успехом, либо ошибкой, либо таймаутом.
    tx: Mutex<Option<oneshot::Sender<DiscoveryResult>>>,

    /// `true`, если discovery уже завершён (успех, ошибка или таймаут).
    /// Повторные отправки после этого не имеют смысла.
    done: AtomicBool,
}

impl Shared {
    /// Обработка входящего UDP-пакета (`VoiceUDPSocket.handleMessage`).
    ///
    /// Аудио и прочие пакеты никем не использовались, поэтому
    /// игнорируются — слой занимается только discovery.
    fn handle_message(&self, msg: &[u8]) {
        // Пакет discovery имеет фиксированную длину 74 байта
        // и начинается с типа 2 (big-endian u16).
        if msg.len() != 74 || u16::from_be_bytes([msg[0], msg[1]]) != 2 {
            return;
        }

        // Адрес — с 8-го байта до первого нуля (`indexOf(0, 8)`,
        // при отсутствии — до len-1).
        // Формат: 8 байт служебных, затем ASCII-адрес, затем 2 байта порта.
        let end = msg[8..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| p + 8)
            .unwrap_or(msg.len() - 2);
        let address = String::from_utf8_lossy(&msg[8..end]).to_string();
        // Порт — последние два байта, big-endian.
        let port = u16::from_be_bytes([msg[msg.len() - 2], msg[msg.len() - 1]]);

        // Если адрес парсится как IPv4 — рукопожатие успешно,
        // статус переходит в `CONNECTED`.
        let result = if address.parse::<Ipv4Addr>().is_ok() {
            self.status.store(STATUS_CONNECTED, Ordering::Release);
            Ok(Handshake { address, port })
        } else {
            Err("Not found IPv4 address".to_string())
        };

        // Фиксируем завершение discovery и отправляем результат наружу.
        // `take()` гарантирует, что отправим ровно один раз.
        self.done.store(true, Ordering::Release);
        if let Some(tx) = self.tx.lock().take() {
            let _ = tx.send(result);
        }
    }
}

/// Клиент UDP: общее состояние плюс handle задачи discovery.
struct Client {
    shared: Arc<Shared>,
    /// Handle задачи discovery. `None`, если задача уже завершилась
    /// (или её ещё не запускали).
    task: Option<JoinHandle<()>>,
}

/// UDP-слой транспорта.
///
/// Управляет одним UDP-клиентом: создаёт сокет, запускает discovery,
/// пересылает пакеты. Состояние клиента — `Option` в мьютексе,
/// потому что клиент может быть уничтожен и создан заново.
#[derive(Default)]
pub struct UdpLayer {
    client: Mutex<Option<Client>>,
}

impl UdpLayer {
    /// `status === "connected"`.
    ///
    /// `true`, только если клиент существует и его статус — `CONNECTED`.
    pub fn ready(&self) -> bool {
        self.client
            .lock()
            .as_ref()
            .map(|c| c.shared.status.load(Ordering::Acquire) == STATUS_CONNECTED)
            .unwrap_or(false)
    }

    /// Статус строкой: `connected` / `connecting` / `disconnected`.
    pub fn status(&self) -> &'static str {
        match self.client.lock().as_ref().map(|c| c.shared.status.load(Ordering::Acquire)) {
            Some(STATUS_CONNECTED) => "connected",
            Some(STATUS_CONNECTING) => "connecting",
            // Всё остальное, включая отсутствие клиента, — `disconnected`.
            _ => "disconnected",
        }
    }

    /// Пакеты, потерянные на стороне клиента.
    ///
    /// Если сокета нет, возвращает 0 — метрика без соединения
    /// не имеет смысла.
    pub fn lost(&self) -> u32 {
        self.with_socket(|s| s.drops()).unwrap_or(0)
    }

    /// Пакеты в очереди отправки.
    ///
    /// Если сокета нет, возвращает 0.
    pub fn packets(&self) -> u32 {
        self.with_socket(|s| s.packets()).unwrap_or(0)
    }

    /// Отправка пакетов: UDP-слой -> Rust-очередь -> Scheduler.
    ///
    /// Реальная отправка идёт в планировщике, поэтому метод не
    /// блокирует вызывающего.
    pub fn packet(&self, frames: Vec<Vec<u8>>) {
        self.with_socket(|s| s.push_packets_native(frames));
    }

    /// Инициализация RTP (SSRC + ключ).
    ///
    /// Без инициализации RTP пакеты не могут быть зашифрованы.
    /// Если сокета нет — возвращает ошибку.
    pub fn initialize_rtp(&self, ssrc: u32, key: Vec<u8>) -> Result<(), String> {
        match self.with_socket(|s| s.initialize_rtp(ssrc, key)) {
            Some(result) => result.map_err(|e| e.to_string()),
            None => Err("UDP is not created".to_string()),
        }
    }

    /// Вызывает `f` с ссылкой на сокет, если сокет есть.
    ///
    /// Внутри забирает `Arc` на `Shared`, чтобы мьютекс `client`
    /// не держался на время работы `f`. Сам сокет защищён своим
    /// мьютексом внутри `Shared`.
    fn with_socket<R>(&self, f: impl FnOnce(&SocketBuffered) -> R) -> Option<R> {
        let shared = self.client.lock().as_ref().map(|c| c.shared.clone())?;
        let guard = shared.socket.lock();
        guard.as_ref().map(f)
    }

    /// Создаёт UDP-подключение и запускает discovery.
    ///
    /// Возвращает приёмник результата (в TS — `Promise<Error | handshake>`).
    /// Ошибка создания сокета тоже приходит как `Err` (в JS такой промис
    /// никогда не завершался).
    pub fn create(&self, ssrc: u32, ip: &str, port: u16) -> oneshot::Receiver<DiscoveryResult> {
        // Если UDP был поднят ранее — уничтожаем. Новый клиент заменяет
        // предыдущий: одновременно поддерживать два нет смысла.
        self.destroy();

        let (tx, rx) = oneshot::channel();

        // Создаём сокет. Ошибка на этом шаге — сразу в канал, чтобы
        // вызывающий получил Err через тот же путь, что и при неудачном
        // discovery.
        let socket = match SocketBuffered::new(format!("{ip}:{port}")) {
            Ok(socket) => socket,
            Err(e) => {
                let _ = tx.send(Err(format!("[Transport/UDP]: {e}")));
                return rx;
            }
        };

        let shared = Arc::new(Shared {
            socket: Mutex::new(Some(socket)),
            status: AtomicU8::new(STATUS_CONNECTING),
            tx: Mutex::new(Some(tx)),
            done: AtomicBool::new(false),
        });

        // Поток приёма: ловит discovery-ответ.
        //
        // Замыкание получает только `Shared`, а не весь `UdpLayer`:
        // так поток приёма не держит слой живым и не мешает его
        // уничтожению.
        {
            let listener = shared.clone();
            let guard = shared.socket.lock();
            if let Some(socket) = guard.as_ref() {
                socket.start_listening_native(move |msg| listener.handle_message(msg));
            }
        }

        // Задача: до MAX_RETRIES отправок discovery с паузой 75 мс
        // и общим таймаутом 2 с.
        let worker = shared.clone();
        let task = runtime::spawn(async move {
            let start = Instant::now();

            for attempt in 1..=MAX_RETRIES {
                // Если discovery уже завершился (ответ пришёл раньше,
                // чем мы успели отправить следующую попытку) — выходим.
                if worker.done.load(Ordering::Acquire) {
                    return;
                }

                // Отправляем discovery. Если сокета уже нет — выходим:
                // уничтожение клиента прерывает и задачу.
                {
                    let guard = worker.socket.lock();
                    match guard.as_ref() {
                        Some(socket) => socket.discovery(ssrc),
                        None => return,
                    }
                }

                // Пауза между попытками. Последняя попытка не паузит —
                // после неё сразу переходим к ожиданию ответа.
                if attempt < MAX_RETRIES {
                    sleep(RETRY_DELAY).await;
                }
            }

            // После всех попыток ждём до общего таймаута. Такой подход
            // даёт равное окно на ответ независимо от того, сколько
            // времени ушло на отправку.
            sleep_until(start + DISCOVERY_TIMEOUT).await;

            // Если за это время ответ так и не пришёл — фиксируем
            // ошибку. `swap` гарантирует, что отправим её только один
            // раз: если `handle_message` уже отправил результат,
            // `swap` вернёт `true` и мы ничего не трогаем.
            if !worker.done.swap(true, Ordering::AcqRel) {
                if let Some(tx) = worker.tx.lock().take() {
                    let _ = tx.send(Err(
                        "[Transport/UDP]: Timeout to send Discovery handshake".to_string()
                    ));
                }
            }
        });

        *self.client.lock() = Some(Client { shared, task: Some(task) });
        rx
    }

    /// Уничтожает UDP-клиент (идемпотентно).
    ///
    /// Порядок важен:
    /// 1. Забираем клиента из мьютекса — после этого `with_socket`
    ///    перестанет его видеть.
    /// 2. Останавливаем задачу discovery.
    /// 3. Помечаем `done` и статус `DISCONNECTED` — на случай, если
    ///    кто-то ещё смотрит на `Shared`.
    /// 4. Забираем `tx` — ожидающий промис получит ошибку приёма
    ///    и тихо завершится.
    /// 5. Уничтожаем сокет уже без мьютекса — `destroy` дожидается
    ///    потока приёма, а держать мьютекс на это время нельзя.
    pub fn destroy(&self) {
        let client = self.client.lock().take();
        let Some(mut client) = client else { return };

        if let Some(task) = client.task.take() {
            task.abort();
        }

        client.shared.done.store(true, Ordering::Release);
        client.shared.status.store(STATUS_DISCONNECTED, Ordering::Release);
        // Незавершённое ожидание получит ошибку приёма и тихо завершится.
        client.shared.tx.lock().take();

        // Сокет забираем из мьютекса и уничтожаем уже без блокировки
        // (`destroy` дожидается потока приёма).
        let socket = client.shared.socket.lock().take();
        if let Some(mut socket) = socket {
            socket.destroy();
        }
    }
}