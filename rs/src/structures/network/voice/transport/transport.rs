use super::{
    dave::{DaveLayer, MAX_DAVE_PROTOCOL},
    udp_layer::{DiscoveryResult, UdpLayer}
};
use crate::{
    structures::network::{
        ws::{
            inner::WsEvent, runtime, VoiceWebSocket,
            opcodes::{close_codes, discord_opcode}
        },
        voice::adapter::AdapterData
    }
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::{fmt, sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc,
}, time::Duration};
use tokio::{sync::mpsc::UnboundedReceiver, task::JoinHandle};

// ============================================================================
// Константы
// ============================================================================

/// Коды закрытия, при которых переподключение запрещено (`STOP_CODES`).
///
/// Если сервер закрывает соединение с одним из этих кодов, значит
/// переподключаться бессмысленно: либо пользователь сам вышел из канала,
/// либо произошло штатное завершение. Попытки переподключения в этом
/// случае только тратят ресурсы и создают лишнюю нагрузку на gateway.
///
/// * `DISCONNECTED` — пользователь намеренно отключился;
/// * `NORMAL` — штатное закрытие без ошибки.
const STOP_CODES: [u32; 2] = [close_codes::DISCONNECTED, close_codes::NORMAL];

/// Сколько ждать каждый этап рукопожатия, прежде чем считать его зависшим.
///
/// Этапы: открытие WS (`ws-connect`), ответ на Identify (`ready`), UDP
/// discovery (`udp-discovery`), ответ на SelectProtocol
/// (`session-description`), ответ на Resume (`resume`). Таймер каждого
/// этапа заменяет предыдущий, поэтому суммарное время рукопожатия не
/// ограничено числом этапов, но ни один этап не может висеть вечно.
/// По истечении срабатывает обычный путь потери соединения (`on_close`):
/// переподключение до `MAX_RECONNECTS`, затем уничтожение.
const HANDSHAKE_STAGE_TIMEOUT: Duration = Duration::from_secs(15);

/// Сколько подряд закрытий WS допускается до уничтожения транспорта.
///
/// Счётчик увеличивается до сравнения, поэтому транспорт уничтожается на
/// `MAX_RECONNECTS`-м закрытии подряд: реально выполняется
/// `MAX_RECONNECTS - 1` переподключений (при 3 — две попытки).
///
/// Счётчик сбрасывается при успешном `Ready` (соединение установилось).
/// Если же соединение рвётся снова и снова, где-то есть проблема,
/// которую переподключением не решить: неверный токен, несуществующий
/// канал, блокировка на стороне Discord. Лучше сдаться и сообщить
/// наверх, чем пытаться вечно и держать ресурсы занятыми.
const MAX_RECONNECTS: u32 = 3;

// ============================================================================
// Структуры данных
// ============================================================================

/// Данные пакета Ready (`WebSocketOpcodes.ready["d"]`).
///
/// Содержит параметры голосового сервера, необходимые для UDP discovery:
/// SSRC (идентификатор нашего RTP-потока), IP и порт для отправки.
#[derive(Clone, Debug)]
pub struct ReadyData {
    /// SSRC нашего потока. Уникален в рамках сессии.
    pub ssrc: u32,

    /// IP-адрес голосового сервера (может быть как IPv4, так и IPv6,
    /// но discovery ожидает IPv4).
    pub ip: String,

    /// UDP-порт для discovery и последующей отправки пакетов.
    pub port: u16,
}

/// Данные SessionDescription (`WebSocketOpcodes.session["d"]`).
///
/// Содержит секретный ключ для шифрования RTP и версию DAVE-протокола
/// (если E2EE включён). Приходит последним в цепочке рукопожатия.
///
/// `Debug` реализован вручную: ключ не должен попадать в логи.
#[derive(Clone)]
pub struct SessionData {
    /// Ключ для AEAD-шифрования RTP-пакетов. Передаётся как массив
    /// чисел в JSON — внутри превращается в `Vec<u8>`.
    pub secret_key: Vec<u8>,

    /// Версия DAVE-протокола, предложенная сервером. `None` или `Some(0)`
    /// означают, что E2EE выключен и DAVE не нужен.
    pub dave_protocol_version: Option<u16>,
}

impl fmt::Debug for SessionData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionData")
            .field("secret_key", &format_args!("<redacted, {} bytes>", self.secret_key.len()))
            .field("dave_protocol_version", &self.dave_protocol_version)
            .finish()
    }
}

// ============================================================================
// Состояния и события
// ============================================================================

/// Состояние транспорта (`TransportState`).
///
/// Жизненный цикл: `Closed` -> `OpeningWs` -> `Identifying` ->
/// `Ready` -> `Session`. При переподключении — `Resuming`.
///
/// Каждое состояние — это не только «где мы сейчас», но и «что уже
/// сделано». Например, `Identifying` хранит payload Identify, чтобы
/// при необходимости отправить его повторно, а `Ready` хранит данные
/// для discovery.
///
/// `Debug` реализован вручную: payload Identify/Resume содержит токен.
#[derive(Clone)]
pub enum TransportState {
    /// Соединение закрыто, ничего не происходит. Исходное состояние
    /// и конечное после `destroy`.
    Closed,

    /// Открываем WebSocket. Переход из `Closed` (первое подключение)
    /// или из `on_close` (переподключение).
    OpeningWs,

    /// Отправили Identify и ждём Ready. Хранит payload Identify,
    /// чтобы можно было отправить его при повторном открытии WS
    /// без пересборки.
    Identifying(Value),

    /// Отправили Resume и ждём Resumed (восстановление после обрыва).
    /// Хранит payload Resume, по той же причине.
    Resuming(Value),

    /// Получили Ready, начинаем discovery UDP. Хранит данные сервера
    /// (ssrc, ip, port) для создания сокета.
    Ready(ReadyData),

    /// Получили SessionDescription, инициализируем шифрование.
    /// Хранит secret_key и версию DAVE.
    Session(SessionData),
}

impl fmt::Debug for TransportState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => f.write_str("Closed"),
            Self::OpeningWs => f.write_str("OpeningWs"),
            Self::Identifying(_) => f.write_str("Identifying(<redacted>)"),
            Self::Resuming(_) => f.write_str("Resuming(<redacted>)"),
            Self::Ready(data) => f.debug_tuple("Ready").field(data).finish(),
            Self::Session(data) => f.debug_tuple("Session").field(data).finish(),
        }
    }
}

/// События транспорта (`TransportEvents`).
///
/// Наружу (в `VoiceConnection`) транспорт сообщает только через них —
/// это единственный способ понять, что происходит внутри. Слушатель
/// передаётся в `new()` и вызывается синхронно из обработчиков.
#[derive(Debug)]
pub enum TransportEvent {
    /// Пытаемся переподключиться, номер попытки (1-based).
    /// Счётчик сбрасывается при успешном `Ready`.
    Reconnect(u32),

    /// Транспорт готов к работе: discovery прошёл успешно, UDP-сокет
    /// создан, можно начинать отправку аудио.
    Open,

    /// Информационное сообщение для лога. Строка уже с префиксом
    /// `[Transport/...]`, чтобы слушатель не занимался форматированием.
    Info(String),

    /// Соединение закрыто, код и причина. Приходит как при
    /// переподключении (перед попыткой), так и при окончательном
    /// закрытии (после `on_error`).
    Close(u32, String),

    /// Транспорт полностью уничтожен. Причина — код из `close_code`.
    /// После этого события никаких других не будет.
    Destroyed(u32),
}

/// Тип слушателя событий транспорта.
///
/// `Arc<dyn Fn>` — потому что слушатель клонируется в замыкания
/// при передаче в задачи (например, discovery). `Send + Sync` —
/// потому что вызовы могут идти из разных потоков.
pub type TransportListener = Arc<dyn Fn(TransportEvent) + Send + Sync>;

// ============================================================================
// Разбор пакетов
// ============================================================================

/// Разбирает поле `d` из пакета Ready.
///
/// Возвращает `None`, если хотя бы одно обязательное поле отсутствует
/// или имеет неверный тип. Это защита от невалидных пакетов: лучше
/// проигнорировать, чем упасть.
///
/// Используется `?` внутри `Some(...)` — если любое из полей не
/// извлекается, вся функция возвращает `None`.
fn parse_ready(d: &Value) -> Option<ReadyData> {
    Some(ReadyData {
        // SSRC приходит как JSON-число; `as_u64` даёт `None` для
        // отрицательных и не-чисел.
        ssrc: u32::try_from(d.get("ssrc")?.as_u64()?).ok()?,

        // IP — строка. `as_str` даёт `None`, если это не строка.
        ip: d.get("ip")?.as_str()?.to_string(),

        // Порт — число; `as u16` обрежет всё, что не влезает в u16.
        port: u16::try_from(d.get("port")?.as_u64()?).ok()?,
    })
}

/// Разбирает поле `d` из пакета SessionDescription.
///
/// `secret_key` приходит как массив чисел (JSON), а не как base64 или
/// строка. Поэтому здесь — преобразование `Vec<u64>` -> `Vec<u8>`.
/// `collect::<Option<Vec<u8>>>()` вернёт `None`, если хоть один элемент
/// не является числом.
fn parse_session(d: &Value) -> Option<SessionData> {
    let secret_key = d
        .get("secret_key")?
        .as_array()?
        .iter()
        // `try_from` вместо `as u8`: молча обрезанный байт испортил бы ключ.
        .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()))
        .collect::<Option<Vec<u8>>>()?;

    Some(SessionData {
        secret_key,

        // Версия DAVE опциональна: если поля нет — E2EE не предлагается.
        dave_protocol_version: d
            .get("dave_protocol_version")
            .and_then(|v| v.as_u64())
            .and_then(|v| u16::try_from(v).ok()),
    })
}

/// Забирает JSON-payload из события WebSocket (без копирования).
///
/// Если payload отсутствует — возвращает `Null`.
/// Это позволяет вызывающим не проверять `Option` на каждом шаге:
/// `take_payload(...).get("op")` работает и для `Null` (возвращает
/// `None`), и для валидного объекта.
fn take_payload(slot: &mut Option<Value>) -> Value {
    slot.take().unwrap_or(Value::Null)
}

// ============================================================================
// Внутреннее состояние
// ============================================================================

/// Внутреннее состояние транспорта.
///
/// Живёт в `Arc`, потому что задачи (события WS, discovery, DAVE) держат
/// на него слабые ссылки. Прямые ссылки создавали бы циклы владения:
/// задача → замыкание → `TransportInner` → задача.
struct TransportInner {
    /// Общие данные адаптера: server, state, clients. Приходят извне
    /// (от `VoiceConnection`) и используются для Identify, DAVE
    /// и построения MLS-дерева.
    adapter: Arc<AdapterData>,

    /// Слушатель событий наружу (в `VoiceConnection`).
    listener: TransportListener,

    /// Текущее состояние конечного автомата. Меняется только через
    /// `set_state`, который заодно выполняет побочные эффекты.
    state: Mutex<TransportState>,

    /// UDP-слой: discovery и отправка пакетов.
    udp: UdpLayer,

    /// WebSocket-соединение. `Option`, потому что может быть уничтожено
    /// в `destroy`, а методы проверяют наличие через `ws()`.
    ws: Mutex<Option<Arc<VoiceWebSocket>>>,

    /// DAVE-слой (E2EE). Управляет MLS-сессией и шифрованием.
    dave: DaveLayer,

    /// Текущий SSRC. Выставляется после `Ready` и используется при
    /// инициализации RTP и отправке пакетов.
    ssrc: Mutex<Option<u32>>,

    /// Количество последовательных переподключений.
    /// Сбрасывается при успешном `Ready`; инкрементируется в `on_close`.
    reconnecting: AtomicU32,

    /// Флаг полного уничтожения. После установки все обработчики
    /// становятся no-op.
    destroyed: AtomicBool,

    /// Handle задачи обработки событий WS. Хранится, чтобы можно было
    /// её остановить в `destroy`.
    event_task: Mutex<Option<JoinHandle<()>>>,

    /// Таймер текущего этапа рукопожатия (см. `HANDSHAKE_STAGE_TIMEOUT`).
    handshake_task: Mutex<Option<JoinHandle<()>>>,

    /// Поколение таймера: устаревший таймер, успевший проснуться в момент
    /// перехода на следующий этап, видит чужое поколение и ничего не делает.
    handshake_gen: AtomicU64,

    /// `true`, пока Identify отложен: WS открылся раньше, чем пришли
    /// `VOICE_SERVER_UPDATE` / `VOICE_STATE_UPDATE`. Как только данные
    /// появляются, `retry_identify` отправляет Identify.
    identify_pending: AtomicBool,
}
impl TransportInner {
    // ---------------------------------------------------------------------
    // Вспомогательные методы
    // ---------------------------------------------------------------------

    /// Отправляет событие слушателю.
    ///
    /// Синхронный вызов: слушатель сам решает, как реагировать
    /// (обычно — кладёт в шину и возвращается).
    fn emit(&self, event: TransportEvent) {
        (self.listener)(event);
    }

    /// Удобная обёртка для отправки информационного события.
    ///
    /// `impl Into<String>` — чтобы можно было передавать и `&str`,
    /// и `String` без ручного `.to_string()`.
    fn info(&self, text: impl Into<String>) {
        self.emit(TransportEvent::Info(text.into()));
    }

    /// Возвращает клон `Arc` на WebSocket, если он ещё жив.
    ///
    /// Клон нужен, чтобы не держать мьютекс `ws` во время работы с
    /// сокетом: `send_text`/`send_binary` могут блокироваться, и держать
    /// мьютекс на это время — значит тормозить других.
    fn ws(&self) -> Option<Arc<VoiceWebSocket>> {
        self.ws.lock().clone()
    }

    /// Отправляет JSON-пакет в WebSocket.
    ///
    /// Ошибки отправки игнорируются: WebSocket сам сообщит о разрыве
    /// через события, и мы обработаем это в `on_close`.
    /// Взводит таймер этапа рукопожатия (предыдущий отменяется).
    ///
    /// Без него любой потерянный ответ сервера (нет Hello/Ready/
    /// SessionDescription, подвисший TCP/TLS) оставлял бы подключение
    /// в состоянии `Connecting` навсегда.
    fn arm_handshake(self: &Arc<Self>, stage: &'static str) {
        let generation = self.handshake_gen.fetch_add(1, Ordering::AcqRel) + 1;
        let weak = Arc::downgrade(self);

        let mut slot = self.handshake_task.lock();
        if let Some(old) = slot.take() {
            old.abort();
        }
        *slot = Some(runtime::spawn(async move {
            tokio::time::sleep(HANDSHAKE_STAGE_TIMEOUT).await;

            let Some(me) = weak.upgrade() else { return };
            if me.handshake_gen.load(Ordering::Acquire) != generation { return; }

            me.on_handshake_timeout(stage);
        }));
    }

    /// Снимает таймер рукопожатия (оно завершено или транспорт уничтожен).
    fn disarm_handshake(&self) {
        self.handshake_gen.fetch_add(1, Ordering::AcqRel);
        if let Some(task) = self.handshake_task.lock().take() {
            task.abort();
        }
    }

    /// Этап рукопожатия не завершился вовремя: считаем соединение потерянным.
    fn on_handshake_timeout(self: &Arc<Self>, stage: &'static str) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        self.info(format!(
            "[Transport]: handshake timeout at stage `{stage}` ({}s)",
            HANDSHAKE_STAGE_TIMEOUT.as_secs()
        ));
        self.on_close(
            close_codes::SESSION_TIMEOUT,
            format!("handshake timeout at stage `{stage}`"),
        );
    }

    fn send_json(&self, value: Value) {
        if let Some(ws) = self.ws() {
            let _ = ws.send_text(value.to_string());
        }
    }

    /// Отправляет бинарный пакет в WebSocket.
    ///
    /// Используется только для DAVE-сообщений (key-package, welcome
    /// с префиксом). Ошибки игнорируются по той же причине.
    fn send_binary(&self, bytes: Vec<u8>) {
        if let Some(ws) = self.ws() {
            let _ = ws.send_binary(bytes);
        }
    }

    /// Подтверждает готовность к переходу DAVE.
    ///
    /// Используется, когда DAVE просит подтвердить, что мы готовы
    /// к смене версии протокола или применению коммита. Без этого
    /// подтверждения переход не завершится у всех участников.
    fn send_transition_ready(&self, transition_id: u64) {
        self.send_json(json!({
            "op": discord_opcode::DAVE_TRANSITION_READY,
            "d": { "transition_id": transition_id }
        }));
    }

    // ---------------------------------------------------------------------
    // Конечный автомат
    // ---------------------------------------------------------------------

    /// Устанавливает состояние и выполняет соответствующие действия.
    ///
    /// Это сердце конечного автомата: каждое состояние имеет свой набор
    /// побочных эффектов (отправка пакета, создание UDP, инициализация
    /// шифрования). Метод вызывается из всех обработчиков, чтобы
    /// гарантировать, что «состояние» и «действия» синхронны.
    fn set_state(self: &Arc<Self>, state: TransportState) {
        // Сначала фиксируем состояние, потом действуем. Если действие
        // вызовет ошибку и захочет откатиться — например, вызвать
        // `destroy` — состояние уже будет актуальным, и повторный
        // `set_state` от `on_close` увидит корректное значение.
        //
        // В `state` секреты (токен из Identify/Resume, ключ из Session)
        // не кладём: сохраняется только фаза, никто другой payload не читает.
        let stored = match &state {
            TransportState::Identifying(_) => TransportState::Identifying(Value::Null),
            TransportState::Resuming(_) => TransportState::Resuming(Value::Null),
            TransportState::Session(data) => TransportState::Session(SessionData {
                secret_key: Vec::new(),
                dave_protocol_version: data.dave_protocol_version,
            }),
            other => other.clone(),
        };
        *self.state.lock() = stored;

        match state {
            // -----------------------------------------------------------------
            // OpeningWs: поднимаем WebSocket.
            // -----------------------------------------------------------------
            TransportState::OpeningWs => {
                // Включая сам `connect_async`: без таймера завис бы и он.
                self.arm_handshake("ws-connect");

                // Endpoint берём из server-пакета (приходит от
                // VOICE_SERVER_UPDATE в `VoiceConnection`).
                let endpoint = self
                    .adapter
                    .server
                    .lock()
                    .as_ref()
                    .and_then(|s| s.endpoint.clone());

                // Соединение считается установленным, если есть endpoint
                // и WebSocket-объект. Иначе — ошибка, транспорт
                // уничтожается.
                //
                // `is_ok()`: connect() возвращает `Result`, но детали
                // ошибки не нужны — факт неудачи достаточен, чтобы
                // послать событие Destroyed.
                let connected = match (endpoint, self.ws()) {
                    (Some(endpoint), Some(ws)) => ws.connect(endpoint).is_ok(),
                    _ => false,
                };

                if !connected {
                    self.emit(TransportEvent::Destroyed(close_codes::VOICE_SERVER_CRASHED));
                }
            }

            // -----------------------------------------------------------------
            // Ready: поднимаем UDP после получения данных от шлюза.
            // -----------------------------------------------------------------
            TransportState::Ready(data) => self.prepare_udp(data),

            // -----------------------------------------------------------------
            // Session: инициализируем шифрование.
            // -----------------------------------------------------------------
            TransportState::Session(mut data) => {
                // Рукопожатие завершено: таймер больше не нужен, а серия
                // неудачных переподключений прерывается именно здесь, а не
                // на `Ready`. Иначе цикл «Ready пришёл, SessionDescription
                // нет» обнулял бы счётчик и переподключался бесконечно.
                self.disarm_handshake();
                self.reconnecting.store(0, Ordering::Release);

                self.info("[Transport/RTP]: has created");

                // RTP инициализируется только если известен SSRC.
                // SSRC выставляется в `on_ready`, поэтому в норме
                // к этому моменту он уже есть. Если нет — логируем
                // ошибку и продолжаем: без SSRC пакеты отправлять
                // нельзя, но `ready()` вернёт false, и вызывающий
                // это увидит.
                let ssrc = *self.ssrc.lock();
                match ssrc {
                    Some(ssrc) => {
                        // Ключ переезжает в RTP без копии: единственный
                        // экземпляр зануляется внутри `initialize_rtp`.
                        let key = std::mem::take(&mut data.secret_key);
                        if let Err(e) = self.udp.initialize_rtp(ssrc, key) {
                            self.info(format!("[Transport/RTP]: {e}"));
                        }
                    }
                    None => {
                        data.secret_key.fill(0);
                        self.info("[Transport/RTP]: ssrc is not set");
                    }
                }

                // Если версия DAVE не нулевая — инициализируем MLS.
                // Нулевая версия означает, что E2EE выключен, и DAVE
                // не нужен: пакеты пойдут без шифрования.
                match data.dave_protocol_version {
                    Some(version) if version != 0 => self.create_dave(version),
                    // E2EE выключен: явно разрешаем отправку без шифрования.
                    // Иначе `dave.packet` отбрасывал бы все кадры.
                    _ => self.dave.set_passthrough(true),
                }
            }

            // -----------------------------------------------------------------
            // Identifying: отправляем Identify.
            // -----------------------------------------------------------------
            TransportState::Identifying(payload) => {
                // Payload уже собран в `on_open` — здесь только
                // отправка. Обёртка `json!` нужна, чтобы соблюсти
                // форму протокола: `{ op, d }`.
                self.send_json(json!({ "op": discord_opcode::IDENTIFY, "d": payload }));
            }

            // -----------------------------------------------------------------
            // Resuming: отправляем Resume.
            // -----------------------------------------------------------------
            TransportState::Resuming(payload) => {
                self.arm_handshake("resume");
                // Аналогично Identify, но с op=7.
                self.send_json(json!({ "op": discord_opcode::RESUME, "d": payload }));
            }

            // -----------------------------------------------------------------
            // Closed: ничего не делаем.
            // -----------------------------------------------------------------
            TransportState::Closed => self.disarm_handshake(),
        }
    }

    /// Создаёт DAVE-сессию с указанной версией протокола.
    ///
    /// DAVE требует user_id и channel_id из state-пакета: без них
    /// MLS не сможет построить группу. Если чего-то не хватает —
    /// логируем и выходим; сессия не создастся, и шифрование
    /// останется выключенным.
    fn create_dave(&self, version: u16) {
        // DAVE требует user_id и channel_id из state-пакета.
        // Забираем их под мьютексом и сразу отпускаем — дальше
        // идёт долгая операция.
        let ids = {
            let state = self.adapter.state.lock();
            state
                .as_ref()
                .map(|s| (s.user_id.clone(), s.channel_id.clone().unwrap_or_default()))
        };

        // Если чего-то не хватает — логируем и выходим.
        // `channel_id` для DAVE обязателен; если его нет (например,
        // state пришёл раньше, чем произошло подключение к каналу),
        // создавать сессию бессмысленно.
        let (Some((user_id, channel_id)), Some(ws)) = (ids, self.ws()) else {
            self.info("[Transport/E2EE]: voice state or websocket is not available");
            return;
        };

        // Создаём сессию. `create` сам позаботится об уничтожении
        // предыдущей, если она была.
        match self.dave.create(version, user_id, channel_id, ws) {
            Ok(()) => self.info(format!(
                "[Transport/E2EE]: has created | {version}/{MAX_DAVE_PROTOCOL}"
            )),
            Err(e) => self.info(format!("[Transport/E2EE]: {e}")),
        }
    }

    /// UDP: создаёт сокет, отправляет discovery; по ответу шлёт Select Protocol.
    ///
    /// Discovery — это UDP-рукопожатие: мы отправляем пакет с SSRC,
    /// сервер отвечает пакетом с нашим внешним адресом и портом.
    /// Без этого мы не знаем, куда отправлять аудио.
    fn prepare_udp(self: &Arc<Self>, data: ReadyData) {
        self.info("[Transport/UDP]: Waiting discovery response");
        self.arm_handshake("udp-discovery");

        // `create` возвращает приёмник результата. Сама задача discovery
        // работает в фоне, а мы ждём её результат асинхронно.
        // Это позволяет не блокировать обработку событий WS, пока
        // идёт discovery (до 2 секунд).
        let receiver = self.udp.create(data.ssrc, &data.ip, data.port);

        let weak = Arc::downgrade(self);
        runtime::spawn(async move {
            // Приёмник закрыт — UDP уничтожен/пересоздан, результат не нужен.
            // `Err` от `receiver.await` означает, что отправитель
            // (oneshot::Sender) был дропнут без отправки: это происходит
            // при `udp.destroy()` до завершения discovery.
            let Ok(result) = receiver.await else { return };

            // Транспорт мог быть уничтожен, пока мы ждали. Слабая
            // ссылка не продлевает жизнь `TransportInner`.
            let Some(me) = weak.upgrade() else { return };

            me.after_discovery(result);
        });
    }

    /// Обрабатывает результат discovery: успех -> Select Protocol, ошибка -> закрытие.
    fn after_discovery(self: &Arc<Self>, result: DiscoveryResult) {
        // Транспорт мог быть уничтожен, пока шёл discovery: тогда не шлём
        // ни `Close` (при ошибке), ни `Open` (при успехе).
        if self.destroyed.load(Ordering::Acquire) { return; }

        let handshake = match result {
            // Ошибка при получении адреса — завершаем. Discovery мог
            // провалиться по разным причинам: тайм-аут, невалидный
            // ответ, ошибка сокета. Код `SERVER_NOT_FOUND` — общий
            // для всех этих случаев.
            Err(e) => {
                self.emit(TransportEvent::Close(close_codes::SERVER_NOT_FOUND, format!("Error: {e}")));
                self.destroy();
                return;
            }
            Ok(handshake) => handshake,
        };

        // Discovery прошёл — транспорт считаем открытым.
        // Слушатель (`VoiceConnection`) переведёт статус в `Connected`.
        self.emit(TransportEvent::Open);
        self.arm_handshake("session-description");

        // Сообщаем шлюзу выбранный протокол и данные для UDP.
        // `aead_aes256_gcm_rtpsize` — обязательный режим шифрования
        // для Discord: другие режимы сервер не принимает.
        self.send_json(json!({
            "op": discord_opcode::SELECT_PROTOCOL,
            "d": {
                "protocol": "udp",
                "data": {
                    "address": handshake.address,
                    "port": handshake.port,
                    "mode": "aead_aes256_gcm_rtpsize"
                }
            }
        }));
    }

    // ---------------------------------------------------------------------
    // Обработчики событий WebSocket
    // ---------------------------------------------------------------------

    /// Обрабатывает событие WebSocket, пришедшее из Rust-канала.
    ///
    /// Диспетчеризация по имени события. Строки (`"open"`, `"close"`...)
    /// совпадают с именами, которые `VoiceWebSocket` передаёт в канал.
    fn handle_ws_event(self: &Arc<Self>, mut event: WsEvent) {
        match event.event.as_str() {
            // WebSocket открыт. Отправляем Identify.
            "open" => self.on_open(),

            // WebSocket закрыт. Пытаемся переподключиться или сдаёмся.
            "close" => {
                let v = take_payload(&mut event.payload);
                // Код по умолчанию 1006 (abnormal closure) — если
                // сервер не прислал код, это единственный корректный
                // выбор.
                let code = v.get("code").and_then(|c| c.as_u64()).unwrap_or(1006) as u32;
                let reason = v
                    .get("reason")
                    .and_then(|r| r.as_str())
                    .unwrap_or("")
                    .to_string();
                self.on_close(code, reason);
            }

            // Сессия восстановлена после переподключения.
            "resumed" => self.on_resumed(),

            // Ready: сервер прислал параметры для UDP.
            "ready" => self.on_ready(take_payload(&mut event.payload)),

            // SessionDescription: секретный ключ для RTP.
            "sessionDescription" => self.on_session_description(take_payload(&mut event.payload)),

            // Ошибка WebSocket. Не пытаемся переподключиться.
            "error" => self.on_error(take_payload(&mut event.payload)),

            // Изменение списка клиентов канала.
            "Users" => self.on_users(take_payload(&mut event.payload)),

            // DAVE-сообщение в JSON (PrepareTransition и т.п.).
            "daveSession" => self.on_dave_session(take_payload(&mut event.payload)),

            // Бинарное DAVE-сообщение.
            "binary" => {
                // Op-код из JSON-обёртки (`{ op, payload: number[] }`).
                let op = take_payload(&mut event.payload)
                    .get("op")
                    .and_then(|o| o.as_u64())
                    .unwrap_or(0);
                self.on_binary(op, event.binary.unwrap_or_default());
            }

            // info / speaking / прочее транспортом не использовалось.
            _ => {}
        }
    }

    /// При открытии WS отправляем Identify.
    ///
    /// Identify — первое сообщение в голосовом протоколе. Без него
    /// сервер не знает, кто мы и в какой канал хотим подключиться.
    fn on_open(self: &Arc<Self>) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        // WS открыт: теперь ждём Ready в ответ на Identify.
        self.arm_handshake("ready");

        // Для Identify нужны оба пакета: server (token) и state (session_id).
        // Если WS открылся раньше, чем пришли `VOICE_SERVER_UPDATE` /
        // `VOICE_STATE_UPDATE`, Identify откладывается и уходит из
        // `retry_identify`, когда данные появятся. Раньше здесь был просто
        // `return`: Identify не уходил никогда, и рукопожатие зависало.
        //
        // Флаг ставится ДО попытки: `retry_identify` забирает его через
        // `swap`, поэтому Identify не уйдёт дважды, а пакет, пришедший между
        // проверкой и записью флага, не потеряется.
        self.identify_pending.store(true, Ordering::Release);
        self.retry_identify();

        if self.identify_pending.load(Ordering::Acquire) {
            self.info("[Transport/WS]: voice server/state packet is missing, Identify deferred");
        }
    }

    /// Отправляет отложенный Identify, если данные для него уже есть.
    ///
    /// Вызывается при открытии WS и при каждом `VOICE_SERVER_UPDATE` /
    /// `VOICE_STATE_UPDATE`. Без отложенного Identify — no-op.
    fn retry_identify(self: &Arc<Self>) {
        if self.destroyed.load(Ordering::Acquire) { return; }
        if !self.identify_pending.swap(false, Ordering::AcqRel) { return; }

        let server = self.adapter.server.lock().clone();
        let state = self.adapter.state.lock().clone();
        let (Some(server), Some(state)) = (server, state) else {
            // Данных всё ещё нет: возвращаем флаг, дождёмся следующего пакета.
            self.identify_pending.store(true, Ordering::Release);
            return;
        };

        // `max_dave_protocol_version` — обязательное поле, даже если DAVE
        // не будем использовать: по нему сервер решает, какую версию предлагать.
        self.set_state(TransportState::Identifying(json!({
            "server_id": state.guild_id,
            "session_id": state.session_id,
            "user_id": state.user_id,
            "token": server.token,
            "max_dave_protocol_version": MAX_DAVE_PROTOCOL
        })));
    }

    /// При закрытии WS пытаемся переподключиться или завершаем работу.
    ///
    /// Логика:
    /// 1. Если код в `STOP_CODES` — переподключаться не надо.
    /// 2. Если уже уничтожены — тоже не надо.
    /// 3. Если закрытий подряд >= `MAX_RECONNECTS` — уничтожаем транспорт
    ///    (то есть переподключений будет `MAX_RECONNECTS - 1`).
    /// 4. Иначе — инкрементируем счётчик и перезапускаем WS.
    fn on_close(self: &Arc<Self>, code: u32, reason: String) {
        // Коды, при которых переподключение запрещено (пользователь вышел,
        // штатное закрытие). Возвращаемся без событий: это нормальный
        // сценарий, обрабатывать нечего.
        if STOP_CODES.contains(&code) || self.destroyed.load(Ordering::Acquire) { return; }

        // Счётчик попыток fetch_add возвращает предыдущее значение,
        // поэтому прибавляем 1, чтобы получить текущую попытку.
        // `AcqRel` — потому что счётчик читается в `ready()` из
        // других потоков, и нам нужна согласованность.
        let attempts = self.reconnecting.fetch_add(1, Ordering::AcqRel) + 1;
        if attempts >= MAX_RECONNECTS {
            self.destroy();
            return;
        }

        // Сообщаем наружу о попытке, перезапускаем WS, сообщаем о закрытии.
        // Порядок: Reconnect -> OpeningWs -> Close. Слушатель видит
        // «попытка N», затем получает уведомление о закрытии с причиной.
        self.emit(TransportEvent::Reconnect(code));
        self.set_state(TransportState::OpeningWs);
        self.emit(TransportEvent::Close(code, format!("[Transport/WS]: {reason}")));
    }

    /// При сигнале resumed отправляем Resume с текущим seq.
    ///
    /// Resume — попытка восстановить сессию, не начиная рукопожатие
    /// с нуля. Discord помнит наше состояние по session_id, и если
    /// session_id тот же, восстановит соединение. `seq_ack` — последний
    /// полученный seq, чтобы сервер знал, откуда продолжать.
    fn on_resumed(self: &Arc<Self>) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let server = self.adapter.server.lock().clone();
        let state = self.adapter.state.lock().clone();
        let (Some(server), Some(state), Some(ws)) = (server, state, self.ws()) else {
            return;
        };

        // Resume — тоже успешное восстановление соединения: сбрасываем
        // счётчик, как и в `on_ready`, иначе `ready()` (требует
        // `reconnecting == 0`) остался бы `false` навсегда.
        self.reconnecting.store(0, Ordering::Release);

        // `seq_ack` из WebSocket: у нас есть геттер `sequence()`,
        // который возвращает последний полученный seq (или -1).
        self.set_state(TransportState::Resuming(json!({
            "server_id": state.guild_id,
            "session_id": state.session_id,
            "token": server.token,
            "seq_ack": ws.sequence()
        })));
    }

    /// При готовности голосового канала запускаем подготовку UDP.
    ///
    /// Ready означает, что сервер принял наш Identify и готов
    /// принимать медиа. Дальше — discovery UDP и Select Protocol.
    fn on_ready(self: &Arc<Self>, packet: Value) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        // Если удалось извлечь данные
        let Some(data) = packet.get("d").and_then(parse_ready) else {
            self.info("[Transport/UDP]: invalid ready packet");
            return;
        };

        // Сохраняем SSRC (нужен для RTP-шифрования и отправки пакетов).
        // Счётчик попыток здесь НЕ сбрасывается: Ready ещё не значит, что
        // рукопожатие завершено — сброс происходит на SessionDescription.
        *self.ssrc.lock() = Some(data.ssrc);

        // Переход в Ready — `set_state` сам вызовет prepare_udp.
        self.set_state(TransportState::Ready(data));
        self.info("[Transport/UDP]: Start creating");
    }

    /// При получении session description инициализируем шифрование.
    ///
    /// SessionDescription — последний шаг рукопожатия: сервер присылает
    /// секретный ключ для RTP и (опционально) версию DAVE. После этого
    /// транспорт готов к отправке/приёму аудио.
    fn on_session_description(self: &Arc<Self>, packet: Value) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        match packet.get("d").and_then(parse_session) {
            // Если удалось извлечь данные
            Some(data) => self.set_state(TransportState::Session(data)),

            // Если не удалось извлечь данные
            None => self.info("[Transport/RTP]: invalid session description packet")
        }
    }

    /// При ошибке WS сообщаем о закрытии без попытки переподключения.
    ///
    /// Ошибка протокола — это не то же самое, что обрыв сети. Скорее
    /// всего, повторное подключение упрётся в ту же ошибку, поэтому
    /// сразу завершаем. Слушатель получит `Close` с кодом `BAD_REQUEST`
    /// и текстом ошибки.
    fn on_error(&self, payload: Value) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        // `message` и `stack` приходят из события ошибки WebSocket. Если чего-то
        // нет — используем дефолты, чтобы не потерять информацию
        // полностью.
        let message = payload
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown WebSocket error");
        let stack = payload.get("stack").and_then(|s| s.as_str()).unwrap_or(message);

        self.emit(TransportEvent::Close(
            close_codes::BAD_REQUEST,
            format!("[Voice/WS-Error]: \n{stack}"),
        ));
    }

    /// Обновление списка подключённых клиентов.
    ///
    /// Список нужен DAVE для построения дерева ключей. Он обновляется
    /// двумя событиями: `CLIENTS_CONNECT` (кто-то зашёл) и
    /// `CLIENT_DISCONNECT` (кто-то вышел). Список хранится в `SetArray`,
    /// чтобы добавление было O(1) и не было дубликатов.
    fn on_users(&self, packet: Value) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        // `d` — данные пакета; у разных op-кодов разная структура.
        let d = packet.get("d");
        match packet.get("op").and_then(|o| o.as_u64()) {
            // Кто-то зашёл: `d.user_ids` — массив строк.
            Some(discord_opcode::CLIENTS_CONNECT) => {
                if let Some(ids) = d.and_then(|d| d.get("user_ids")).and_then(|v| v.as_array()) {
                    let mut clients = self.adapter.clients.lock();
                    // `filter_map` отбрасывает не-строки. `add` сам
                    // игнорирует дубликаты.
                    for id in ids.iter().filter_map(|v| v.as_str()) {
                        clients.add(id.to_string());
                    }
                }
            }

            // Кто-то вышел: `d.user_id` — строка.
            Some(discord_opcode::CLIENT_DISCONNECT) => {
                if let Some(id) = d.and_then(|d| d.get("user_id")).and_then(|v| v.as_str()) {
                    self.adapter.clients.lock().delete(id);
                }
            }
            _ => {}
        }
    }

    /// Сообщения DAVE в JSON: PrepareTransition / ExecuteTransition / PrepareEpoch.
    ///
    /// Эти сообщения приходят в текстовом виде (JSON), в отличие от
    /// commit/welcome, которые приходят бинарными данными.
    fn on_dave_session(&self, packet: Value) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        let Some(op) = packet.get("op").and_then(|o| o.as_u64()) else { return };
        let d = packet.get("d").cloned().unwrap_or(Value::Null);

        // Общие поля, которые встречаются в нескольких op-кодах.
        let transition_id = d.get("transition_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let protocol_version = d.get("protocol_version").and_then(|v| v.as_u64()).unwrap_or(0) as u16;

        match op {
            // Подготовка перехода: если нужно подтверждение — отвечаем Ready, иначе reinit.
            discord_opcode::DAVE_PREPARE_TRANSITION => {
                // `with_live` вернёт `None`, если сессии нет или она
                // уничтожена — тогда просто ничего не делаем.
                let result = self
                    .dave
                    .with_live(|c| c.prepare_transition(transition_id as u16, protocol_version));

                match result {
                    // Переход требует подтверждения — отправляем Ready.
                    Some(Ok(true)) => self.send_transition_ready(transition_id),

                    // Переход не требует — сразу инициализируемся заново.
                    // Это возможно, если обе стороны согласны с версией
                    // без дополнительного обмена.
                    Some(Ok(false)) => {
                        if let Some(Err(e)) = self.dave.with_live(|c| c.reinit()) {
                            self.info(format!("[Transport/E2EE]: {e}"));
                        }
                    }

                    Some(Err(e)) => self.info(format!("[Transport/E2EE]: {e}")),
                    None => {}
                }
            }

            // Выполнение подготовленного перехода (ответа не требуется).
            discord_opcode::DAVE_EXECUTE_TRANSITION => {
                self.dave.with_live(|c| c.execute_transition(transition_id as u16));
            }

            // Подготовка новой эпохи (ответа не требуется).
            // Только эпоха 1 запускает инициализацию — остальные
            // используются для ротации ключей внутри уже работающей
            // сессии.
            discord_opcode::DAVE_PREPARE_EPOCH => {
                let epoch = d.get("epoch").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                if let Some(Err(e)) = self.dave.with_live(|c| c.prepare_epoch(protocol_version, epoch)) {
                    self.info(format!("[Transport/E2EE]: {e}"));
                }
            }

            _ => {}
        }
    }

    /// Бинарные сообщения DAVE: ExternalSender / Proposals / Commit / Welcome.
    ///
    /// `op` — первый байт payload (или отдельное поле в JSON-обёртке),
    /// `payload` — остальные байты.
    fn on_binary(&self, op: u64, payload: Vec<u8>) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        match op {
            // Внешний отправитель MLS-сессии. Приходит один раз,
            // до proposals/commit. Без него MLS не сможет проверять
            // подписи.
            discord_opcode::DAVE_MLS_EXTERNAL_SENDER => {
                if let Some(Err(e)) = self.dave.with_live(|c| c.set_external_sender(payload)) {
                    self.info(format!("[Transport/E2EE]: {e}"));
                }
            }

            // Proposals: commit (+ welcome) отправляем обратно с префиксом-опкодом.
            //
            // Discord ждёт, что ответ на proposals будет с определённым
            // префиксом в первом байте. Здесь мы этот префикс и добавляем.
            discord_opcode::DAVE_MLS_PROPOSALS => {
                // Список клиентов нужен MLS, чтобы построить корректное
                // дерево. `to_vec()` — потому что `array()` возвращает
                // срез, а замыкание `with_live` требует владения.
                let clients = self.adapter.clients.lock().array().to_vec();
                match self.dave.with_live(|c| c.process_proposals(&payload, &clients)) {
                    // Сессия вернула commit — отправляем его с префиксом.
                    Some(Ok(Some(proposal))) => {
                        let mut packet = Vec::with_capacity(proposal.len() + 1);
                        packet.push(discord_opcode::DAVE_MLS_COMMIT_WELCOME as u8);
                        packet.extend_from_slice(&proposal);
                        self.send_binary(packet);
                    }
                    Some(Err(e)) => self.info(format!("[Transport/E2EE]: {e}")),
                    _ => {}
                }
            }

            // Commit: после успешного применения подтверждаем переход.
            discord_opcode::DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION => {
                self.confirm_transition(self.dave.with_live(|c| c.process_commit(&payload)));
            }

            // Welcome: так же — применяем и подтверждаем переход.
            discord_opcode::DAVE_MLS_WELCOME => {
                self.confirm_transition(self.dave.with_live(|c| c.process_welcome(&payload)));
            }

            _ => {}
        }
    }

    /// Подтверждает переход, если DAVE его применил и он ненулевой.
    ///
    /// Нулевой `transition_id` означает «переход завершён сразу», его
    /// подтверждать не нужно. `success == false` означает, что сессия
    /// не смогла применить переход — тогда тоже не подтверждаем,
    /// слушатель сам разберётся по ошибке.
    fn confirm_transition(&self, result: Option<Result<(u16, bool), String>>) {
        match result {
            // Если переход удался
            Some(Ok((transition_id, true))) if transition_id != 0 => {
                self.send_transition_ready(transition_id as u64);
            }

            // Если переход завершился ошибкой
            Some(Err(e)) => self.info(format!("[Transport/E2EE]: {e}")),
            _ => {}
        }
    }

    /// Уничтожает транспорт (идемпотентно).
    ///
    /// Порядок важен: сначала помечаем `destroyed` (чтобы никакие
    /// обработчики не начали новую работу), затем уведомляем наружу,
    /// затем останавливаем всё остальное.
    fn destroy(&self) {
        // Swap: если уже true — выходим, повторный вызов ничего не делает.
        // `AcqRel` — потому что флаг читается в других потоках, и нам
        // нужна согласованность с событиями, которые они отправляют.
        if self.destroyed.swap(true, Ordering::AcqRel) { return; }

        // Сообщаем наружу причину — `CALL_TERMINATED`. Слушатель
        // (`VoiceConnection`) удалит соединение из БД и очистит
        // состояние.
        self.emit(TransportEvent::Destroyed(close_codes::CALL_TERMINATED));
        *self.state.lock() = TransportState::Closed;
        self.disarm_handshake();

        // Останавливаем задачу обработки событий WS. Это гарантирует,
        // что после `destroy` никакие новые события не будут обработаны.
        if let Some(task) = self.event_task.lock().take() {
            task.abort();
        }

        // Уничтожаем WebSocket, UDP и DAVE. `ws.lock().take()` —
        // забираем из `Option`, чтобы повторный `destroy` не пытался
        // уничтожить уже уничтоженное.
        let ws = self.ws.lock().take();
        if let Some(ws) = ws { ws.destroy(); }

        // UDP и DAVE уничтожают свои ресурсы внутри, повторный вызов
        // безопасен.
        self.udp.destroy();
        self.dave.destroy();
    }
}

// ============================================================================
// Публичный API
// ============================================================================

/// Транспорт голосового соединения Discord.
///
/// Публичный фасад над `TransportInner`. Все методы — либо делегаты,
/// либо тонкие обёртки для удобства вызывающего.
pub struct Transport {
    inner: Arc<TransportInner>
}
impl Transport {
    /// Создаёт транспорт, WebSocket и запускает цикл обработки событий.
    ///
    /// # Аргументы
    /// * `adapter` — общие данные адаптера (server/state/clients).
    /// * `listener` — слушатель событий наружу.
    pub fn new(adapter: Arc<AdapterData>, listener: TransportListener) -> Self {
        // WebSocket создаётся здесь же: он принадлежит транспорту
        // и уничтожается вместе с ним.
        let ws = Arc::new(VoiceWebSocket::new());

        // `subscribe_native` отдаёт канал событий напрямую из Rust,
        // события обрабатываются в своём темпе.
        let receiver: UnboundedReceiver<WsEvent> = ws.subscribe_native();

        let inner = Arc::new(TransportInner {
            adapter,
            listener,
            state: Mutex::new(TransportState::Closed),
            udp: UdpLayer::default(),
            ws: Mutex::new(Some(ws)),
            dave: DaveLayer::default(),
            ssrc: Mutex::new(None),
            reconnecting: AtomicU32::new(0),
            destroyed: AtomicBool::new(false),
            event_task: Mutex::new(None),
            handshake_task: Mutex::new(None),
            handshake_gen: AtomicU64::new(0),
            identify_pending: AtomicBool::new(false)
        });

        // Обработчик событий WS: последовательно.
        // Один цикл на все события — так гарантируется порядок
        // обработки, как будто это происходит в одном потоке.
        //
        // Слабая ссылка: задача не продлевает жизнь `TransportInner`.
        // Когда транспорт уничтожается, `weak.upgrade()` вернёт `None`,
        // и задача завершится по `break`.
        let weak = Arc::downgrade(&inner);
        let mut receiver = receiver;
        let task = runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                let Some(me) = weak.upgrade() else { break };
                me.handle_ws_event(event);
            }
        });
        *inner.event_task.lock() = Some(task);

        Self { inner }
    }

    /// Проверка наличия WebSocket без клонирования Arc (горячий путь).
    ///
    /// Используется в `VoiceSpeakerManager::has_ws`, который
    /// вызывается на каждый пакет. Клонирование `Arc` здесь было бы
    /// лишним инкрементом refcount.
    pub fn has_ws(&self) -> bool {
        self.inner.ws.lock().is_some()
    }

    /// Готовность к безопасной передаче аудио.
    ///
    /// Все условия должны выполняться одновременно: WebSocket открыт,
    /// DAVE готов (или не используется), UDP готов, пришёл SessionDescription
    /// и нет незавершённых переподключений.
    pub fn ready(&self) -> bool {
        let ws_ready = self
            .inner
            .ws
            .lock()
            .as_ref()
            .map(|ws| ws.ready())
            .unwrap_or(false);

        ws_ready
            && self.inner.dave.ready()
            && self.inner.udp.ready()
            && matches!(*self.inner.state.lock(), TransportState::Session(_))
            && self.inner.reconnecting.load(Ordering::Acquire) == 0
    }

    /// Устанавливает состояние конечного автомата.
    ///
    /// Это публичная обёртка над `TransportInner::set_state`. Вызывать
    /// её напрямую имеет смысл только из `VoiceConnection` — например,
    /// при старте подключения, чтобы инициировать открытие WebSocket.
    /// Внутри транспорта состояние меняется само, по событиям WS.
    ///
    /// Побочные эффекты зависят от того, какое состояние передали:
    /// * `OpeningWs` — открывает WebSocket;
    /// * `Ready` — запускает discovery UDP;
    /// * `Session` — инициализирует RTP и (если нужно) DAVE;
    /// * `Identifying` / `Resuming` — отправляет соответствующий пакет.
    ///
    /// Поэтому просто «запомнить состояние» нельзя: метод делает работу.
    pub fn set_state(&self, state: TransportState) {
        self.inner.set_state(state);
    }

    /// Возвращает клон `Arc` на WebSocket, если он ещё жив.
    ///
    /// Клон нужен, чтобы вызывающий мог работать с сокетом, не удерживая
    /// мьютекс `ws`: `send_text` / `send_binary` могут блокироваться,
    /// и держать мьютекс на это время — значит тормозить других, кто
    /// тоже хочет отправить пакет.
    ///
    /// `None` означает, что транспорт уже уничтожен — WebSocket забран
    /// из `Option` в `destroy`. Вызывающий должен быть готов к этому:
    /// после `destroy` отправлять некуда.
    pub fn ws(&self) -> Option<Arc<VoiceWebSocket>> {
        self.inner.ws()
    }

    /// Возвращает текущий SSRC, если он уже известен.
    ///
    /// SSRC выставляется в `on_ready` (после пакета Ready от сервера)
    /// и не меняется до конца сессии. До этого момента возвращает `None`.
    ///
    /// Используется, например, при отправке пакета Speaking: в нём
    /// нужно указать SSRC, чтобы сервер знал, к какому потоку относится
    /// «говорит/молчит». Если SSRC ещё нет — отправлять Speaking
    /// бессмысленно, вызывающий должен проверить `None`.
    pub fn ssrc(&self) -> Option<u32> {
        *self.inner.ssrc.lock()
    }

    /// Возвращает ссылку на UDP-слой.
    /// Через эту ссылку вызывающий может:
    /// * проверить `ready()` / `status()` / `lost()` / `packets()`;
    /// * отправить пакеты через `packet(...)` (минуя DAVE — только
    ///   если вызывающий сам знает, что делает);
    /// * инициализировать RTP через `initialize_rtp(...)`.
    ///
    /// Обычно вызывать напрямую не нужно: `Transport::packet` уже
    /// прогоняет кадры через DAVE и отправляет в UDP. Ссылка торчит
    /// наружу для геттеров и отладки.
    pub fn udp(&self) -> &UdpLayer {
        &self.inner.udp
    }

    /// Аудио-пакеты проходят цепочку DAVE -> RTP -> UDP.
    ///
    /// Если DAVE вернул `None` (переход/повторный запуск), кадры отбрасываются
    ///
    /// Цепочка:
    /// 1. `dave.packet(frames)` — шифрует (если E2EE включён).
    /// 2. `udp.packet(encrypted)` — оборачивает в RTP и отправляет.
    pub fn packet(&self, frames: Vec<Vec<u8>>) {
        if let Some(encrypted) = self.inner.dave.packet(frames) {
            self.inner.udp.packet(encrypted);
        }
    }

    /// Уничтожает транспорт и освобождает все связанные ресурсы.
    ///
    /// Публичная обёртка над `TransportInner::destroy`. Вызывается из
    /// `VoiceConnection` при выходе из канала, при ошибке подключения
    /// и из `Drop`.
    ///
    /// # Что происходит внутри
    ///
    /// Порядок действий (важен, чтобы не оставить висящих ресурсов):
    /// 1. Выставляется флаг `destroyed` — все обработчики событий
    ///    становятся no-op, повторные вызовы ничего не делают.
    /// 2. Наружу отправляется `TransportEvent::Destroyed` с кодом
    ///    `CALL_TERMINATED` — `VoiceConnection` по нему удаляет
    ///    соединение из БД и чистит состояние.
    /// 3. Состояние переводится в `Closed`.
    /// 4. Останавливается задача обработки событий WebSocket —
    ///    после этого новые события не будут обработаны.
    /// 5. Уничтожаются WebSocket, UDP-слой и DAVE-сессия.
    ///
    /// # Идемпотентность
    ///
    /// Повторный вызов безопасен: `destroyed.swap(true, ...)` вернёт
    /// `true`, и метод выйдет сразу. Это важно, потому что `destroy`
    /// может вызываться из нескольких мест: явно из `VoiceConnection`,
    /// из `on_close` при исчерпании попыток переподключения, из `Drop`.
    ///
    /// # Состояние после вызова
    ///
    /// * `ready()` возвращает `false`;
    /// * `ws()` возвращает `None`;
    /// * `packet(...)` ничего не делает (DAVE и UDP уничтожены);
    /// * `status()` (через `VoiceConnection`) — `disconnected`.
    ///
    /// То есть объект остаётся валидным как значение, но перестаёт
    /// выполнять какую-либо работу.
    pub fn destroy(&self) {
        self.inner.destroy();
    }

    /// Сообщает транспорту, что пришли новые `VOICE_SERVER_UPDATE` /
    /// `VOICE_STATE_UPDATE`: если Identify был отложен, он отправляется.
    pub fn retry_identify(&self) {
        self.inner.retry_identify();
    }
}