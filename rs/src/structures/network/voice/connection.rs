use crate::structures::network::ws::{opcodes::discord_opcode, runtime};
use super::{
    adapter::{AdapterData, ServerPacket, StatePacket},
    utils::{
        speaker::{SpeakerHost, VoiceSpeakerManager, SpeakerType},
        bus::{HostBus, HostEvent}
    },
    transport::{
        transport::{Transport, TransportEvent, TransportState},
    }
};
use napi::{
    bindgen_prelude::{Buffer, Error, Function, Result},
    threadsafe_function::ThreadsafeFunctionCallMode,
};
use napi_derive::napi;
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tokio::task::JoinHandle;
use std::time::Duration;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};

/// Сколько подключение может оставаться в `Connecting` до уничтожения.
///
/// Покрывает этап, который транспорт не видит: gateway не прислал
/// `VOICE_SERVER_UPDATE` / `VOICE_STATE_UPDATE` (нет прав на канал,
/// канал удалён, gateway потерял пакет). Этапы самого рукопожатия
/// (WS, Ready, discovery, SessionDescription) контролирует транспорт
/// своими таймерами и переподключениями.
const CONNECT_DEADLINE: Duration = Duration::from_secs(30);

/// Параметры голосового подключения (`VoiceConnectionConfiguration`).
///
/// Все поля опциональны, кроме флагов `self_deaf` и `self_mute`:
/// они всегда передаются в gateway как есть.
#[napi(object)]
pub struct VoiceConnectionConfig {
    /// Идентификатор гильдии. `None` для личных сообщений.
    #[napi(js_name = "guild_id")]
    pub guild_id: Option<String>,

    /// Идентификатор канала. `None` означает «не подключаться».
    #[napi(js_name = "channel_id")]
    pub channel_id: Option<String>,

    /// Отключить звук от других участников.
    #[napi(js_name = "self_deaf")]
    pub self_deaf: bool,

    /// Отключить свой микрофон.
    #[napi(js_name = "self_mute")]
    pub self_mute: bool,

    /// Предпочитаемый динамик (для клиентов с несколькими выходами).
    #[napi(js_name = "self_speaker")]
    pub self_speaker: Option<u32>
}

/// Внутренняя копия конфигурации, не привязанная к napi.
///
/// Отделена от `VoiceConnectionConfig`, чтобы не тащить napi-атрибуты
/// в горячий путь и чтобы можно было менять поля независимо от JS-объекта.
///
/// Зачем копия, а не прямая ссылка на JS-объект:
/// * `VoiceConnectionConfig` — это `#[napi(object)]`, его поля читаются
///   через границу Rust/JS, что дороже обычного доступа к памяти;
/// * JS-сторона может изменить свой объект в любой момент, а нам нужна
///   стабильная конфигурация на время сессии;
/// * часть полей (`channel_id`) меняется из Rust (при `disconnect`
///   и `set_channel`), и мутировать JS-объект с другой стороны границы
///   было бы странно.
///
/// Клонируется при необходимости: `Config` — небольшая структура,
/// клонирование дешевле, чем синхронизация с JS-объектом на каждое
/// чтение.
#[derive(Clone)]
struct Config {
    /// Идентификатор гильдии.
    ///
    /// `None` для личных сообщений — в этом случае в gateway-пакете
    /// `guild_id` не передаётся вовсе (в отличие от `channel_id`,
    /// который передаётся всегда, даже как `null`).
    ///
    /// Не меняется в течение жизни подключения: гильдия определяется
    /// при создании и не может быть изменена без пересоздания.
    guild_id: Option<String>,

    /// Идентификатор голосового канала.
    ///
    /// `Some(id)` — бот находится (или пытается находиться) в канале
    /// с этим id. `None` — бот не в канале: либо ещё не подключался,
    /// либо вышел через `disconnect`.
    ///
    /// В отличие от `guild_id`, меняется в течение жизни: `set_channel`
    /// выставляет новое значение, `disconnect` — сбрасывает в `None`.
    /// Именно по этому полю формируется `channel_id` в gateway-пакете:
    /// `None` уходит как `null` — это сигнал Discord «выйти из канала».
    channel_id: Option<String>,

    /// Отключить звук от других участников (`self_deaf` в Discord).
    ///
    /// Передаётся в gateway как есть, без интерпретации. Discord сам
    /// решает, что делать: обычно это отключает приём аудио на клиенте.
    /// Меняется только через пересоздание подключения.
    self_deaf: bool,

    /// Отключить свой микрофон (`self_mute` в Discord).
    ///
    /// Аналогично `self_deaf`: передаётся в gateway как есть.
    /// Отличие от `SpeakerType::Disable` в том, что `self_mute` —
    /// это «микрофон выключен на уровне клиента», а `Disable` —
    /// «не передаю голос прямо сейчас». Оба могут быть выставлены
    /// одновременно, и это нормально.
    self_mute: bool,

    /// Предпочитаемый динамик (`self_speaker`).
    ///
    /// `None` — использовать значение по умолчанию (`SpeakerType::Enable`).
    /// `Some(v)` — конкретная маска из `SpeakerType`; `v` может быть
    /// не только одним из известных вариантов (1, 2, 4), но и их
    /// комбинацией (например, 5 = микрофон + приоритет).
    ///
    /// Хранится как `u32`, а не `SpeakerType`, по двум причинам:
    /// * значение приходит из JS как `Option<u32>` — приведение к `u8`
    ///   делается только при использовании, чтобы не терять данные,
    ///   если JS пришлёт что-то за пределами `u8`;
    /// * `SpeakerType` живёт в другом модуле (спикер), и тащить его
    ///   сюда ради одного поля — лишняя связность.
    self_speaker: Option<u32>
}

impl Config {
    /// Пакет для gateway: `{ op: VoiceStateUpdate, d: configuration }`.
    ///
    /// Как и `JSON.stringify` в JS: `undefined`-поля (`guild_id`, `self_speaker`)
    /// опускаются, `channel_id = null` отправляется как `null`.
    fn payload(&self) -> Value {
        let mut d = Map::new();

        // `guild_id` не передаём, если его нет (личные сообщения).
        if let Some(guild_id) = &self.guild_id {
            d.insert("guild_id".into(), Value::String(guild_id.clone()));
        }
        // `channel_id` передаём всегда: `None` означает «выйти из канала»,
        // и gateway должен получить явный `null`.
        d.insert(
            "channel_id".into(),
            match &self.channel_id {
                Some(id) => Value::String(id.clone()),
                None => Value::Null,
            },
        );
        d.insert("self_deaf".into(), Value::Bool(self.self_deaf));
        d.insert("self_mute".into(), Value::Bool(self.self_mute));
        if let Some(speaker) = self.self_speaker {
            d.insert("self_speaker".into(), Value::from(speaker));
        }

        json!({ "op": discord_opcode::VOICE_STATE_UPDATE, "d": Value::Object(d) })
    }
}

/// Статусы подключения (`ConnectionStatus`).
///
/// Соответствуют строковым значениям, которые видит JS-сторона.
///
/// Отдельный enum, а не строки, потому что внутри Rust сравнения
/// и `match` по строкам медленнее и легче допускают опечатки.
/// Наружу (в геттер `status`) состояние отдаётся строкой — так JS-стороне
/// удобнее: `socket.status === "connected"` читается лучше, чем
/// числовой код, и не требует синхронизации констант между Rust и JS.
///
/// `Copy` — потому что статус читается часто (геттеры, логи, проверки
/// в `ready`) и клонировать его через `clone()` было бы шумно.
/// `PartialEq` — для сравнений вроде `status == Status::Connected`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    /// Подключение отсутствует: либо ещё не начинали, либо вышли
    /// из канала, либо транспорт уничтожен.
    ///
    /// Это же состояние выставляется в `disconnect` и в `destroy`.
    Disconnected,

    /// Идёт переподключение после обрыва.
    ///
    /// Отдельное состояние от `Connecting`, потому что для JS-стороны
    /// это разные сценарии: `Connecting` — «первое подключение,
    /// покажем спиннер», `Reconnecting` — «соединение было, оборвалось,
    /// пытаемся восстановить, покажем другой индикатор». С точки зрения
    /// протокола шаги одинаковые (открыть WS, отправить Identify/Resume),
    /// но UI-логика различается.
    Reconnecting,

    /// Идёт первое подключение (или подключение к новому каналу).
    ///
    /// В это состояние переходит `set_status(Connecting)` — в том числе
    /// при `start()` из конструктора JS-обёртки. Пока статус `Connecting`,
    /// транспорт отправляет конфигурацию в gateway (см. `send_config`).
    Connecting,

    /// Подключение установлено, канал активен.
    ///
    /// Выставляется из `on_transport_event` при `TransportEvent::Open`
    /// (discovery прошёл успешно, UDP готов). Именно в этом состоянии
    /// `ready()` может вернуть `true`.
    Connected
}

impl Status {
    /// Строковое представление для JS-геттера `status`.
    ///
    /// Используется в `NativeVoiceConnection::status`, который
    /// вызывается из JS. Возвращает `&static str`, чтобы не выделять
    /// память на каждый вызов геттера — статус читается часто,
    /// в том числе из логики UI.
    ///
    /// Значения совпадают с тем, что ждёт JS-сторона: `"disconnected"`,
    /// `"reconnecting"`, `"connecting"`, `"connected"`. Если менять
    /// строки — нужно синхронно править и `parse`, и JS-код, который
    /// на них завязан.
    fn as_str(self) -> &'static str {
        match self {
            Status::Disconnected => "disconnected",
            Status::Reconnecting => "reconnecting",
            Status::Connecting => "connecting",
            Status::Connected => "connected"
        }
    }

    /// Разбор строки, пришедшей из JS-сеттера `status`.
    ///
    /// Используется в `NativeVoiceConnection::set_status`, когда JS-сторона
    /// выставляет `socket.status = "..."`. Возвращает `Option`, а не
    /// дефолтное значение, чтобы вызывающий сам решил, как реагировать
    /// на неизвестную строку: `set_status` превращает `None` в ошибку
    /// `"Unknown status: ..."`.
    ///
    /// Неизвестное значение — это всегда ошибка вызывающего, а не
    /// проблема парсера: лучше явно сказать «такого статуса нет»,
    /// чем молча поставить `Disconnected` и делать вид, что всё хорошо.
    ///
    /// Регистр важен: `"Connected"` не распарсится, только `"connected"`.
    /// Это осознанно: строки — контракт с JS-стороной, и раз мы их
    /// фиксируем в `as_str`, то и принимаем в том же виде.
    fn parse(value: &str) -> Option<Self> {
        match value {
            "disconnected" => Some(Status::Disconnected),
            "reconnecting" => Some(Status::Reconnecting),
            "connecting" => Some(Status::Connecting),
            "connected" => Some(Status::Connected),
            _ => None
        }
    }
}

/// Разделяемое состояние голосового подключения.
///
/// Живёт в `Arc`, потому что доступ идёт из нескольких мест:
/// napi-обёртки, транспорта (через слабую ссылку) и менеджера говорящих.
struct ConnectionInner {
    /// Текущая конфигурация. Меняется при `set_channel` / `disconnect`.
    config: Mutex<Config>,

    /// Текущий статус подключения.
    status: Mutex<Status>,

    /// Слабая ссылка на себя: нужна таймеру, который не должен продлевать
    /// жизнь подключению.
    me: Weak<ConnectionInner>,

    /// Таймер `CONNECT_DEADLINE`.
    connect_timer: Mutex<Option<JoinHandle<()>>>,

    /// Флаг полного уничтожения подключения.
    /// После установки все публичные методы становятся no-op.
    destroyed: AtomicBool,

    /// `true`, пока gateway-адаптер в JS активен (`this.adapter` в TS не `null`).
    /// Когда адаптер уничтожается, отправлять ему конфигурацию бессмысленно.
    adapter_alive: AtomicBool,

    /// Данные адаптера: серверный пакет и state-пакет.
    adapter: Arc<AdapterData>,

    /// Шина событий наружу (в JS) и логов.
    bus: Arc<HostBus>,

    /// Транспорт: WebSocket, UDP, RTP.
    transport: Transport,

    /// Менеджер говорящих: кто сейчас передаёт голос.
    speaker: Arc<VoiceSpeakerManager>
}

impl SpeakerHost for ConnectionInner {
    /// Голос по умолчанию: из конфигурации или `ENABLE`.
    fn default_speaker(&self) -> SpeakerType {
        self.config
            .lock()
            .self_speaker
            .and_then(|v| u8::try_from(v).ok())
            .map(SpeakerType::from_bits)
            // Значение вне `u8` — мусор из JS; `as u8` обрезал бы его
            // (256 стало бы 0 = «не говорит»), поэтому берём `Enable`.
            .unwrap_or(SpeakerType::Enable)
    }

    /// `true`, если WebSocket-соединение установлено.
    /// Проверка без клонирования `Arc`.
    fn has_ws(&self) -> bool {
        self.transport.has_ws()
    }

    /// Отправляет пакет Speaking в голосовой WebSocket.
    fn send_speaking(&self, speaking: SpeakerType) {
        let Some(ws) = self.transport.ws() else { return };

        let packet = json!({
            "op": discord_opcode::SPEAKING,
            "d": {
                "speaking": speaking.bits(),
                "delay": 0,
                "ssrc": self.transport.ssrc()
            },
            "seq": ws.sequence()
        });

        let _ = ws.send_text(packet.to_string());
    }
}

impl ConnectionInner {
    /// Создаёт внутреннее состояние и связывает транспорт с обработчиком событий.
    fn new(config: VoiceConnectionConfig) -> Arc<Self> {
        // `new_cyclic` даёт слабую ссылку на создаваемый объект — нужна,
        // чтобы транспорт мог уведомлять подключение без циклической ссылки.
        Arc::new_cyclic(|weak: &Weak<ConnectionInner>| {
            let adapter = Arc::new(AdapterData::default());
            let bus = HostBus::new();

            // События транспорта возвращаются в подключение.
            let listener_weak = weak.clone();
            let transport = Transport::new(
                adapter.clone(),
                Arc::new(move |event| {
                    if let Some(connection) = listener_weak.upgrade() {
                        connection.on_transport_event(event);
                    }
                })
            );

            // Менеджер говорящих получает слабую ссылку на хост,
            // чтобы не создавать цикл владения.
            let host: Weak<dyn SpeakerHost> = weak.clone();
            let speaker = VoiceSpeakerManager::new(host);

            ConnectionInner {
                config: Mutex::new(Config {
                    guild_id: config.guild_id,
                    channel_id: config.channel_id,
                    self_deaf: config.self_deaf,
                    self_mute: config.self_mute,
                    self_speaker: config.self_speaker,
                }),
                status: Mutex::new(Status::Disconnected),
                me: weak.clone(),
                connect_timer: Mutex::new(None),
                destroyed: AtomicBool::new(false),
                adapter_alive: AtomicBool::new(true),
                adapter, bus, transport, speaker
            }
        })
    }

    /// Устанавливает режим говорящего (микрофон).
    fn set_speaking(&self, speaking: SpeakerType) {
        self.speaker.set_speaking(speaking);
    }

    /// `adapter.send(configuration)`.
    /// Отправляет конфигурацию через шину, если адаптер ещё активен.
    fn send_config(&self) {
        if !self.adapter_alive.load(Ordering::Acquire) { return; }
        let payload = self.config.lock().payload();
        self.bus.emit(HostEvent::Send(payload));
    }

    /// Выставляет статус, только если подключение не уничтожено.
    ///
    /// Проверка `destroyed` идёт ПОД локом статуса, а `destroy` выставляет
    /// флаг до записи `Disconnected`: поздний `Open` из другого потока
    /// не может «воскресить» статус `Connected` после уничтожения.
    fn set_status_alive(&self, status: Status) -> bool {
        let mut slot = self.status.lock();
        if self.destroyed.load(Ordering::Acquire) { return false; }
        *slot = status;

        // Дедлайн живёт ровно пока идёт подключение. Порядок локов:
        // `status` -> `connect_timer`; таймер при срабатывании берёт
        // только `status`, поэтому инверсии нет.
        match status {
            Status::Connecting => self.arm_connect_deadline(),
            Status::Connected | Status::Disconnected => self.disarm_connect_deadline(),
            Status::Reconnecting => {}
        }
        true
    }

    /// Взводит дедлайн подключения (предыдущий отменяется).
    fn arm_connect_deadline(&self) {
        let weak = self.me.clone();
        let mut slot = self.connect_timer.lock();
        if let Some(old) = slot.take() {
            old.abort();
        }
        *slot = Some(runtime::spawn(async move {
            tokio::time::sleep(CONNECT_DEADLINE).await;
            let Some(this) = weak.upgrade() else { return };
            this.on_connect_deadline();
        }));
    }

    /// Снимает дедлайн подключения.
    fn disarm_connect_deadline(&self) {
        if let Some(task) = self.connect_timer.lock().take() {
            task.abort();
        }
    }

    /// Подключение не установилось за `CONNECT_DEADLINE`: уничтожаем его,
    /// чтобы не оставлять «зомби» в `Connecting`, и сообщаем JS-стороне
    /// (событие `destroyed`).
    fn on_connect_deadline(&self) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        let status = *self.status.lock();
        if matches!(status, Status::Connected | Status::Disconnected) { return; }

        self.bus.log(
            false,
            format!(
                "[Voice]: connection timeout ({}s) in status `{}`",
                CONNECT_DEADLINE.as_secs(),
                status.as_str()
            ),
        );
        self.destroy();
    }

    /// Обрабатывает события транспорта.
    fn on_transport_event(&self, event: TransportEvent) {
        match event {
            // Переподключаемся.
            TransportEvent::Reconnect(_) => {
                // Если подключение уже уничтожено
                if self.destroyed.load(Ordering::Acquire) { return; }
                self.send_config();
                self.set_speaking(SpeakerType::Disable);
            }

            // Транспортный шлюз открыт.
            TransportEvent::Open => {
                // Если подключение уже уничтожено
                if self.destroyed.load(Ordering::Acquire) { return; }
                self.set_status_alive(Status::Connected);
            }

            // Информационное сообщение от транспорта.
            TransportEvent::Info(text) => {
                // Если подключение уже уничтожено
                if self.destroyed.load(Ordering::Acquire) { return; }
                self.bus.log(true, text);
            }

            // Транспортный шлюз закрывается.
            TransportEvent::Close(code, reason) => {
                // Если подключение уже уничтожено
                if self.destroyed.load(Ordering::Acquire) { return; }

                self.set_speaking(SpeakerType::Disable);
                self.set_status_alive(Status::Disconnected);
                self.bus.log(true, format!("{code}: {reason}"));
            }

            // Транспортный шлюз полностью закрывается.
            TransportEvent::Destroyed(_) => self.destroy(),
        }
    }

    /// Сеттер `status`: `connecting` отправляет конфигурацию в Discord.
    fn set_status(&self, status: Status) -> std::result::Result<(), String> {
        if self.destroyed.load(Ordering::Acquire) {
            return Ok(());
        }

        // Нельзя перейти в `connecting`, если адаптер уже уничтожен.
        else if status == Status::Connecting && !self.adapter_alive.load(Ordering::Acquire) {
            return Err("Adapter has not found".to_string());
        }

        // Всегда выставляем статус — включая Connecting.
        else if !self.set_status_alive(status) {
            return Ok(());
        }

        // При переходе в Connecting отправляем конфигурацию в gateway.
        else if status == Status::Connecting {
            self.send_config();
        }
        Ok(())
    }

    /// Выход из канала: статус — Disconnected, `channel_id = None`.
    fn disconnect(&self) {
        if self.destroyed.load(Ordering::Acquire) || !self.adapter_alive.load(Ordering::Acquire) { return; }
        // Намеренно не идём через set_status(Connecting): статус должен
        // остаться Disconnected (мы выходим из канала), а конфиг — уйти.
        if !self.set_status_alive(Status::Disconnected) { return; }

        self.config.lock().channel_id = None;
        self.send_config();
    }

    /// Переход в указанный канал: сохраняет `channel_id` и инициирует подключение.
    fn set_channel(&self, id: String) {
        if self.destroyed.load(Ordering::Acquire) || !self.adapter_alive.load(Ordering::Acquire) { return; }

        self.config.lock().channel_id = Some(id);
        let _ = self.set_status(Status::Connecting);
    }

    /// Регистрирует пакет VOICE_SERVER_UPDATE.
    ///
    /// Если endpoint пуст или отсутствует — пакет игнорируется: подключаться некуда.
    fn on_voice_server_update(&self, token: String, guild_id: String, endpoint: Option<String>) {
        let endpoint = endpoint.filter(|e| !e.is_empty());
        if self.destroyed.load(Ordering::Acquire) || endpoint.is_none() { return; }

        self.bus.log(false, "[Voice]: server update applied");

        *self.adapter.server.lock() = Some(ServerPacket { token, guild_id, endpoint });
        // Инициируем открытие WebSocket-соединения.
        self.transport.set_state(TransportState::OpeningWs);
    }

    /// Регистрирует пакет VOICE_STATE_UPDATE.
    fn on_voice_state_update(&self, guild_id: Option<String>, user_id: String, session_id: String, channel_id: Option<String>) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        self.bus.log(false, "[Voice]: client update applied");

        *self.adapter.state.lock() = Some(StatePacket { guild_id, user_id, session_id, channel_id });

        // Если WS открылся раньше этого пакета, Identify был отложен.
        self.transport.retry_identify();
    }

    /// Подготавливает аудио-пакеты и отправляет их.
    ///
    /// Это горячий путь: вызывается 50 раз в секунду.
    fn packet(&self, frames: Vec<Vec<u8>>) {
        if self.destroyed.load(Ordering::Acquire) { return; }
        // Активируем микрофон перед отправкой: если он был выключен,
        // слушатели должны увидеть начало передачи.
        self.speaker.set_speaking(self.speaker.default_type());
        self.transport.packet(frames);
    }

    /// `true`, если подключение активно, статус `connected` и транспорт готов.
    fn ready(&self) -> bool {
        !self.destroyed.load(Ordering::Acquire)
            && *self.status.lock() == Status::Connected
            && self.transport.ready()
    }

    /// Уничтожает голосовое соединение (идемпотентно).
    ///
    /// Порядок важен:
    /// 1. Выставляем флаг `destroyed` — дальше никто не должен начинать работу.
    /// 2. Запоминаем `guild_id` для события `Destroyed`.
    /// 3. Сбрасываем статус и уведомляем шину.
    /// 4. Отправляем gateway пустой `channel_id` (если адаптер ещё жив).
    /// 5. Уничтожаем говорящих и транспорт.
    /// 6. Уведомляем об уничтожении адаптера.
    fn destroy(&self) {
        // swap: если уже true — выходим, это повторный вызов.
        if self.destroyed.swap(true, Ordering::AcqRel) { return; }

        let guild_id = self.adapter.state.lock().as_ref()
            .and_then(|s| s.guild_id.clone())
            .or_else(|| self.config.lock().guild_id.clone());

        *self.status.lock() = Status::Disconnected;
        self.disarm_connect_deadline();
        self.bus.log(false, "[Voice/Cleaner] has destroyed");

        if guild_id.is_some() {
            self.bus.emit(HostEvent::Destroyed(guild_id));
        }

        // Если адаптер ещё активен, сообщаем gateway о выходе из канала.
        if self.adapter_alive.load(Ordering::Acquire) {
            self.config.lock().channel_id = None;
            self.send_config();
        }

        // Уничтожаем внутренние компоненты.
        self.speaker.destroy();
        self.transport.destroy();

        // Помечаем адаптер как уничтоженный и уведомляем JS-сторону.
        self.adapter_alive.store(false, Ordering::Release);
        self.bus.emit(HostEvent::AdapterDestroy);
    }
}

/// Голосовое подключение к Discord, доступное из JavaScript.
///
/// Napi-обёртка над `ConnectionInner`: JS-сторона видит объект
/// `VoiceConnection` с методами `start`, `packet`, `disconnect`, `destroy`
/// и геттерами `status`, `ready`, `ssrc` и т.д. Вся логика живёт
/// в `ConnectionInner`; здесь только адаптация типов на границе
/// Rust/JS и единая точка входа для JS-кода.
///
/// # Зачем два слоя
///
/// `ConnectionInner` не помечен `#[napi]` и не зависит от napi вообще.
/// Это позволяет:
/// * тестировать логику подключения без napi-рантайма;
/// * передавать `ConnectionInner` в транспорт и другие компоненты,
///   не таща за собой napi-обёртку;
/// * на границе Rust/JS делать только преобразования типов, не смешивая
///   их с бизнес-логикой.
///
/// Плата — лишний уровень делегирования: каждый публичный метод
/// `NativeVoiceConnection` — тонкая обёртка над методом `ConnectionInner`.
/// Это осознанный компромисс: чистота внутреннего слоя важнее пары
/// лишних строк делегирования.
///
/// # Владение
///
/// `inner: Arc<ConnectionInner>` — потому что на `ConnectionInner`
/// ссылаются сразу несколько мест:
/// * сама napi-обёртка (этот объект);
/// * транспорт (через слабую ссылку в обработчике событий);
/// * менеджер говорящих (через слабую ссылку в `SpeakerHost`).
///
/// Слабости там — намеренные: транспорт и спикер не должны продлевать
/// жизнь подключению, иначе получатся циклы владения (`ConnectionInner` →
/// транспорт → замыкание → `ConnectionInner`). А вот сама napi-обёртка
/// владеет `Arc` напрямую: пока JS-сторона держит объект, подключение
/// живо.
///
/// # Время жизни
///
/// Создаётся в конструкторе (`#[napi(constructor)]`) и живёт до тех пор,
/// пока JS-сторона держит на него ссылку. При уничтожении (Drop от napi
/// или явный `destroy()`) вызывает `ConnectionInner::destroy`, который
/// идемпотентно освобождает все ресурсы. После этого объект остаётся
/// валидным как значение, но методы становятся no-op.
///
/// # JS-имя
///
/// `js_name = "VoiceConnection"` — в JS-коде класс называется
/// `VoiceConnection`, без префикса `Native`. Префикс нужен только
/// в Rust, чтобы не пересекаться с внутренним `ConnectionInner`
/// и явно показать, что это нативная часть.
#[napi(js_name = "VoiceConnection")]
pub struct NativeVoiceConnection {
    /// Разделяемое состояние подключения.
    ///
    /// `Arc`, а не голое поле, потому что доступ к состоянию идёт из
    /// нескольких мест одновременно (napi-обёртка, транспорт, спикер).
    /// Внутри `ConnectionInner` все изменяемые поля защищены мьютексами
    /// и атомиками — сам по себе `Arc` потокобезопасность не даёт,
    /// он только позволяет разделять владение.
    inner: Arc<ConnectionInner>
}

#[napi]
impl NativeVoiceConnection {
    /// Создаёт подключение с указанной конфигурацией.
    ///
    /// Конфигурация приходит из JS в виде `VoiceConnectionConfig`
    /// (нативная структура с `#[napi(object)]`). Внутри конструктора
    /// она копируется в `Config` — внутреннее представление, не привязанное
    /// к napi. Дальше JS-объект конфигурации нами уже не используется:
    /// все изменения (`set_channel`, `disconnect`) идут во внутреннюю копию.
    ///
    /// Конструктор только создаёт объект. Никакого соединения не
    /// устанавливается: для этого нужно вызвать `start()` или `set_channel()`.
    /// Разделение намеренное: конструктор должен быть дешёвым и не
    /// выполнять I/O, чтобы JS-сторона могла создать объект заранее
    /// и решить, когда его запускать.
    #[napi(constructor)]
    pub fn new(config: VoiceConnectionConfig) -> Self {
        Self { inner: ConnectionInner::new(config) }
    }

    /// Регистрирует единственный обработчик событий Rust -> JS.
    ///
    /// Все события (логи, отправка пакетов в gateway, уничтожение
    /// соединения) идут через одну потокобезопасную функцию. Внутри
    /// Rust это `ThreadsafeFunction`, которая умеет безопасно вызываться
    /// из любого потока и ставить вызов в очередь JS-рантайма.
    ///
    /// # Почему одна функция, а не несколько
    ///
    /// Каждая `ThreadsafeFunction` — это свой объект с собственной
    /// очередью и счётчиком ссылок. На горячем пути (пакеты 50 раз в
    /// секунду) лишние функции дают заметный overhead. Одна функция
    /// дешевле и проще: JS-сторона разбирает JSON по полю `t`
    /// (`log` / `send` / `destroyed` / `adapter_destroy`) и решает,
    /// куда его направить.
    ///
    /// # Режим вызова
    ///
    /// `ThreadsafeFunctionCallMode::NonBlocking` — вызов не блокирует
    /// Rust-поток, если очередь JS-рантайма переполнена. Для событий
    /// это правильно: потерять лог при перегрузке лучше, чем застопорить
    /// транспорт. Ошибка `call()` игнорируется — если JS-сторона
    /// уничтожена, событие уже никому не нужно.
    ///
    /// # Ошибки
    ///
    /// Возвращает ошибку, если не удалось построить `ThreadsafeFunction`
    /// (например, callback уже освобождён на стороне JS).
    #[napi]
    pub fn on_event(&self, callback: Function<String, ()>) -> Result<()> {
        // Строим потокобезопасную функцию. Это дорогая операция,
        // но выполняется один раз при инициализации подключения.
        let js_fn = callback.build_threadsafe_function().build()?;

        // Замыкание получает уже готовую JSON-строку и передаёт её
        // в JS. `Arc` нужен, потому что шина хранит получателя
        // в `Arc<dyn Fn>` и вызывает его из разных потоков.
        self.inner.bus.set_sink(Arc::new(move |text: String| {
            let _ = js_fn.call(text, ThreadsafeFunctionCallMode::NonBlocking);
        }));
        Ok(())
    }

    /// Подключается к голосовому каналу.
    ///
    /// Переводит статус в `Connecting` — это первое действие,
    /// которое запускает всю цепочку: `ConnectionInner::set_status`
    /// при переходе в `Connecting` отправляет конфигурацию в gateway
    /// (через `send_config`). Дальше события пойдут сами: gateway
    /// пришлёт `VOICE_SERVER_UPDATE` и `VOICE_STATE_UPDATE`, транспорт
    /// начнёт рукопожатие.
    ///
    /// # Ошибки
    ///
    /// Возвращает ошибку, если gateway-адаптер уже уничтожен
    /// (`adapter_alive == false`) — в этом случае отправлять
    /// конфигурацию некуда, и подключение невозможно.
    /// Уже уничтоженное подключение (`destroyed == true`) ошибкой
    /// не считается: `set_status` тихо выходит, и `start()` вернёт `Ok(())`.
    #[napi]
    pub fn start(&self) -> Result<()> {
        self.inner
            .set_status(Status::Connecting)
            .map_err(Error::from_reason)
    }

    /// Обрабатывает пакет `VOICE_SERVER_UPDATE` от gateway.
    ///
    /// Пакет содержит token, guild_id и endpoint голосового сервера —
    /// без него нельзя начать подключение. Вызывается из JS-стороны,
    /// когда gateway-адаптер получает соответствующий пакет от Discord.
    ///
    /// Внутри (`on_voice_server_update`) данные сохраняются
    /// в `adapter.server` и запускается открытие WebSocket
    /// (`TransportState::OpeningWs`).
    ///
    /// `endpoint: Option<String>` — `None`, если сервер не прислал
    /// endpoint. Внутри такой пакет игнорируется: подключаться некуда.
    /// Это нормальная ситуация: Discord иногда присылает пакет без
    /// endpoint, и ждать нужно следующего.
    #[napi]
    pub fn on_voice_server_update(&self, token: String, guild_id: String, endpoint: Option<String>) {
        self.inner.on_voice_server_update(token, guild_id, endpoint);
    }

    /// Обрабатывает пакет `VOICE_STATE_UPDATE` от gateway.
    ///
    /// Пакет содержит данные о текущем голосовом состоянии клиента:
    /// `user_id`, `session_id`, `channel_id`, `guild_id`. Без него
    /// нельзя отправить Identify: сервер должен знать, кто мы и в каком
    /// канале находимся.
    ///
    /// `guild_id` и `channel_id` — `Option`, потому что для личных
    /// сообщений `guild_id` отсутствует, а `channel_id` может быть
    /// `None`, если пользователь вышел из канала.
    ///
    /// Внутри (`on_voice_state_update`) данные сохраняются в `adapter.state`.
    /// Если транспорт уже ждёт — рукопожатие продолжится.
    #[napi]
    pub fn on_voice_state_update(&self, guild_id: Option<String>, user_id: String, session_id: String, channel_id: Option<String>) {
        self.inner.on_voice_state_update(guild_id, user_id, session_id, channel_id);
    }

    /// Отправляет аудио-пакеты (Opus).
    ///
    /// Это горячий путь: вызывается примерно 50 раз в секунду
    /// (каждые 20 мс — один Opus-кадр). Любая лишняя работа здесь
    /// напрямую влияет на задержку и плавность звука.
    ///
    /// На границе napi `Buffer` (JS-представление бинарных данных)
    /// превращается в обычный `Vec<u8>`. Приходится копировать:
    /// `Buffer` принадлежит JS-рантайму, и передать его напрямую
    /// в Rust-структуры нельзя — владение несовместимо. Копия
    /// неизбежна, но она одна: дальше по цепочке (DAVE -> RTP -> UDP)
    /// кадры передаются как `Vec<u8>` без дополнительных копий.
    ///
    /// `into_iter().map(|frame| frame.to_vec()).collect()` — идиоматичный
    /// способ превратить `Vec<Buffer>` в `Vec<Vec<u8>>` без промежуточных
    /// аллокаций сверх необходимых.
    ///
    /// Дальше `ConnectionInner::packet`:
    /// 1. Активирует микрофон (если он выключен — включает).
    /// 2. Отдаёт пакеты в транспорт (DAVE -> RTP -> UDP).
    ///
    /// Если DAVE не готов (идёт переход) — пакеты отбрасываются.
    #[napi]
    pub fn packet(&self, frames: Vec<Buffer>) {
        self.inner.packet(frames.into_iter().map(|frame| frame.to_vec()).collect());
    }

    /// Выходит из голосового канала.
    ///
    /// Не уничтожает подключение целиком (для этого есть `destroy`),
    /// а именно выходит из канала: статус переходит в `Disconnected`,
    /// `channel_id` сбрасывается, конфигурация с `null` уходит в gateway.
    /// После этого можно снова вызвать `set_channel` и войти в другой канал.
    ///
    /// Внутри (`disconnect`) намеренно не идёт через `set_status(Connecting)`:
    /// статус должен остаться `Disconnected`, а конфигурация — уйти.
    /// Если бы шли через `set_status`, статус перезаписался бы
    /// на `Connecting`, что неверно.
    #[napi]
    pub fn disconnect(&self) {
        self.inner.disconnect();
    }

    /// Переключается в указанный канал.
    ///
    /// Устанавливает `channel_id` и инициирует подключение
    /// (`set_status(Connecting)`). Если подключение уже активно —
    /// Discord сам корректно переключит канал.
    ///
    /// Если `destroyed == true` или адаптер уничтожен — метод ничего
    /// не делает (тихо выходит), а не возвращает ошибку. Это осознанно:
    /// вызов на уже уничтоженном объекте — не ошибка вызывающего,
    /// а состояние гонки, которое лучше проигнорировать, чем валить
    /// в JS.
    #[napi]
    pub fn set_channel(&self, id: String) {
        self.inner.set_channel(id);
    }

    /// Устанавливает статус подключения по строковому имени.
    ///
    /// Строка парсится в `Status`; неизвестная строка — ошибка.
    /// Ошибка возвращается, а не игнорируется, потому что неизвестный
    /// статус — это всегда баг вызывающего кода (опечатка в имени,
    /// несинхронизированные константы между Rust и JS).
    ///
    /// Внутри `ConnectionInner::set_status` могут быть свои проверки:
    /// например, переход в `Connecting` при уничтоженном адаптере
    /// вернёт ошибку. Такая ошибка проходит через `map_err` и тоже
    /// попадает в JS.
    #[napi]
    pub fn set_status(&self, status: String) -> Result<()> {
        // `ok_or_else` превращает `Option<Status>` в `Result<Status, Error>`
        // с понятным сообщением. `format!` здесь — не на горячем пути,
        // так что аллокация строки не страшна.
        let status = Status::parse(&status)
            .ok_or_else(|| Error::from_reason(format!("Unknown status: {status}")))?;
        self.inner.set_status(status).map_err(Error::from_reason)
    }

    /// Полностью уничтожает подключение.
    ///
    /// Идемпотентен: повторный вызов ничего не делает. Внутри (`destroy`)
    /// выставляет флаг, отправляет событие `Destroyed` наружу, уничтожает
    /// WebSocket, UDP, DAVE, спикера. После вызова объект остаётся
    /// валидным как значение, но все методы становятся no-op.
    ///
    /// Также вызывается из `Drop` (при сборке мусора на JS-стороне).
    /// Явный вызов полезен, когда JS-сторона хочет освободить ресурсы
    /// немедленно, не дожидаясь сборщика мусора.
    #[napi]
    pub fn destroy(&self) {
        self.inner.destroy();
    }

    // ---------------------------------------------------------------------
    // Геттеры
    // ---------------------------------------------------------------------

    /// Текущий статус подключения строкой.
    ///
    /// Возвращает одно из: `"disconnected"`, `"reconnecting"`,
    /// `"connecting"`, `"connected"`. `.to_string()` — потому что
    /// JS-сторона ожидает `String`, а `as_str()` возвращает
    /// `&'static str`. Аллокация на каждый вызов неизбежна,
    /// но это геттер, а не горячий путь.
    #[napi(getter)]
    pub fn status(&self) -> String {
        self.inner.status.lock().as_str().to_string()
    }

    /// `true`, если подключение готово к отправке и приёму аудио.
    ///
    /// Проверяет несколько условий одновременно:
    /// * не уничтожено;
    /// * статус `Connected`;
    /// * транспорт готов (WebSocket + UDP + RTP + DAVE).
    ///
    /// Геттер, а не событие: JS-сторона сама решает, как часто его
    /// читать. Внутри `ConnectionInner::ready` — обычная проверка
    /// атомиков, так что читать дёшево.
    #[napi(getter)]
    pub fn ready(&self) -> bool {
        self.inner.ready()
    }

    /// `channel_id` из последнего `VOICE_STATE_UPDATE`.
    ///
    /// Нужен `Voices.join`-подобной логике на JS-стороне: перед входом
    /// в канал надо знать, в каком канале мы сейчас, чтобы не делать
    /// лишних переключений или корректно обработать «уже в канале».
    ///
    /// `Option<String>` — `None`, если state-пакета ещё не было
    /// или пользователь вышел из канала.
    #[napi(getter)]
    pub fn state_channel_id(&self) -> Option<String> {
        self.inner
            .adapter
            .state
            .lock()
            .as_ref()
            .and_then(|s| s.channel_id.clone())
    }

    /// `true`, если транспорт полностью готов (WebSocket + UDP).
    ///
    /// Отличается от `ready()`: здесь проверяется только транспорт,
    /// без учёта статуса подключения. Полезно для диагностики —
    /// понять, на каком этапе рукопожатия мы застряли.
    #[napi(getter)]
    pub fn transport_ready(&self) -> bool {
        self.inner.transport.ready()
    }

    /// SSRC текущей голосовой сессии.
    ///
    /// SSRC — идентификатор нашего RTP-потока. Выставляется после пакета
    /// Ready от сервера. До этого момента — `None`.
    ///
    /// Используется, например, при отправке Speaking: в пакете нужно
    /// указать SSRC, чтобы сервер знал, к какому потоку относится
    /// «говорит/молчит».
    #[napi(getter)]
    pub fn ssrc(&self) -> Option<u32> {
        self.inner.transport.ssrc()
    }

    /// `true`, если WebSocket-соединение активно.
    ///
    /// `.map(...).unwrap_or(false)` — если WebSocket уже уничтожен
    /// (после `destroy`), считаем, что не готов. Это безопаснее, чем
    /// возвращать `true` или паниковать.
    #[napi(getter)]
    pub fn ws_ready(&self) -> bool {
        self.inner.transport.ws().map(|ws| ws.ready()).unwrap_or(false)
    }

    /// Последний полученный seq по WebSocket.
    ///
    /// `-1`, если соединения нет или seq ещё не получен. Значение
    /// нужно для Resume: при переподключении мы сообщаем серверу,
    /// откуда продолжать, чтобы не терять пакеты.
    #[napi(getter)]
    pub fn ws_sequence(&self) -> i64 {
        self.inner.transport.ws().map(|ws| ws.sequence()).unwrap_or(-1)
    }

    /// `true`, если UDP-соединение готово.
    ///
    /// «Готово» означает, что discovery прошёл успешно, сокет создан
    /// и можно отправлять пакеты. До discovery или после `destroy` —
    /// `false`.
    #[napi(getter)]
    pub fn udp_ready(&self) -> bool {
        self.inner.transport.udp().ready()
    }

    /// Текущий статус UDP-соединения строкой.
    ///
    /// Возвращает одно из: `"disconnected"`, `"connecting"`,
    /// `"connected"`. Полезно для диагностики: если `transport_ready`
    /// `false`, можно посмотреть, на каком этапе застряло UDP.
    #[napi(getter)]
    pub fn udp_status(&self) -> String {
        self.inner.transport.udp().status().to_string()
    }

    /// Количество отправленных UDP-пакетов.
    ///
    /// Метрика для диагностики: если пакеты отправляются, но звука
    /// нет — проблема на стороне получателя. Если не отправляются —
    /// проблема у нас.
    #[napi(getter)]
    pub fn udp_packets(&self) -> u32 {
        self.inner.transport.udp().packets()
    }

    /// Количество потерянных UDP-пакетов.
    ///
    /// Метрика для диагностики проблем с сетью. «Потерянные» здесь —
    /// на стороне клиента (не ушли в сокет или отброшены в очереди),
    /// а не на стороне получателя.
    #[napi(getter)]
    pub fn udp_drops(&self) -> u32 {
        self.inner.transport.udp().lost()
    }
}

/// Гарантированное освобождение при сборке мусора
impl Drop for NativeVoiceConnection {
    fn drop(&mut self) {
        self.inner.destroy();
        self.inner.bus.close();
    }
}