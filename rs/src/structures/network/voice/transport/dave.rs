use crate::structures::{
    crypto::mls::{results::MlsError, session::MlsSession as Native},
    network::ws::VoiceWebSocket,
    network::ws::opcodes::discord_opcode
};
use parking_lot::Mutex;
use serde_json::json;
use std::sync::Arc;

/// Максимальная поддерживаемая версия протокола DAVE.
///
/// Отправляется в `Identify` и используется при создании нативной сессии.
/// Если Discord предложит версию выше — мы её не примем.
pub const MAX_DAVE_PROTOCOL: u16 = 1;

/// Время (с) режима без шифрования при версии 0.
///
/// Когда версия протокола равна 0 (E2EE выключен), сессия переходит
/// в режим passthrough на ограниченное время — чтобы буферы успели
/// опустеть и переключение не порвало звук.
const TRANSITION_EXPIRY: u32 = 10;

/// Значение `status` нативной сессии, при котором она готова шифровать
/// (в TS: `status === 3`).
const STATUS_ACTIVE: u8 = 3;

/// События обёртки (`ClientMLSEvents`: `key`, `invalidateTransition`).
///
/// Обёртка не отправляет пакеты сама — она сообщает о том, что нужно
/// отправить, через этот канал.
pub enum DaveEvent {
    /// Готов новый key-package; его нужно отправить как бинарный пакет
    /// с префиксом `OPCODE_DAVE_MLS_KEY`.
    Key(Vec<u8>),
    
    /// Переход невалиден; нужно отправить JSON-пакет с op 31.
    InvalidateTransition(u16)
}

/// Тип получателя событий обёртки.
pub type DaveSink = Arc<dyn Fn(DaveEvent) + Send + Sync>;

/// Преобразует ошибку MLS в строку для логов и сообщений наружу.
fn err_str(e: MlsError) -> String {
    e.to_string()
}


/// Обёртка над нативной MLS-сессией (`MLSSession` из TS).
///
/// Управляет версией протокола, отложенным external sender, обработкой
/// proposals/commit/welcome и шифрованием. Нативная сессия создаётся
/// лениво — при первом действии, которому она нужна.
pub struct MlsWrapper {
    /// Текущая версия протокола.
    version: u16,

    /// Идентификатор пользователя (строка до парсинга).
    user_id: String,

    /// Идентификатор канала (строка до парсинга).
    channel_id: String,

    /// Флаг уничтожения обёртки.
    /// После установки все методы становятся no-op.
    destroyed: bool,

    /// Локальный флаг повторной инициализации.
    /// Используется, пока нативная сессия ещё не создана.
    reinitializing_local: bool,

    /// External sender, отложенный до создания нативной сессии.
    /// Некоторые пакеты приходят раньше, чем сессия готова их принять.
    pending_external_sender: Option<Vec<u8>>,

    /// Нативная сессия. `None` до первой инициализации.
    session: Option<Native>,

    /// Получатель событий (key-package, invalid transition).
    sink: DaveSink
}
impl MlsWrapper {
    /// Создаёт обёртку без нативной сессии.
    ///
    /// Сессия появится позже — при первом вызове, которому она нужна.
    pub fn new(version: u16, user_id: String, channel_id: String, sink: DaveSink) -> Self {
        Self {
            version,
            user_id,
            channel_id,
            destroyed: false,
            reinitializing_local: false,
            pending_external_sender: None,
            session: None,
            sink
        }
    }

    /// `destroyed`: обёртка или нативная сессия уничтожены.
    ///
    /// Проверка обеих частей нужна потому, что нативная сессия может
    /// быть уничтожена независимо (например, через `destroy` на ней).
    pub fn destroyed(&self) -> bool {
        self.destroyed || self.session.as_ref().map(|s| s.destroyed()).unwrap_or(false)
    }

    /// Внутренний статус нативной сессии.
    ///
    /// `None`, если сессия ещё не создана.
    pub fn status(&self) -> Option<u8> {
        self.session.as_ref().and_then(|s| s.status())
    }

    /// `true`, если нативная сессия выполняет переход.
    ///
    /// Пока идёт переход, шифровать нельзя: версия протокола ещё
    /// не устоялась.
    pub fn is_transitioning(&self) -> bool {
        self.session.as_ref().map(|s| s.is_transitioning()).unwrap_or(false)
    }

    /// `true`, если идёт повторная инициализация.
    ///
    /// Если нативной сессии ещё нет, используется локальный флаг —
    /// он выставляется при получении commit/welcome до создания сессии.
    pub fn reinitializing(&self) -> bool {
        self.session
            .as_ref()
            .map(|s| s.reinitializing())
            .unwrap_or(self.reinitializing_local)
    }

    /// Создаёт нативную сессию, если её ещё нет.
    ///
    /// Заодно применяет отложенный external sender — он мог прийти
    /// до того, как сессия была создана.
    fn create_session(&mut self) -> Result<(), String> {
        if self.session.is_some() { return Ok(()); }

        self.session = Some(Native::new(
            self.version,
            self.user_id.clone(),
            self.channel_id.clone(),
        ));

        if let Some(pending) = self.pending_external_sender.take() {
            if let Some(session) = self.session.as_mut() {
                session
                    .set_external_sender(&pending)
                    .map_err(err_str)?;
            }
        }
        Ok(())
    }

    /// `session.externalSender = ...`
    ///
    /// Если сессия уже создана, применяет значение сразу. Иначе
    /// откладывает до создания — иначе данные потеряются.
    pub fn set_external_sender(&mut self, data: Vec<u8>) -> Result<(), String> {
        match self.session.as_mut() {
            Some(session) => session
                .set_external_sender(&data)
                .map_err(err_str),
            None => {
                self.pending_external_sender = Some(data);
                Ok(())
            }
        }
    }

    /// `session.prepareEpoch = { epoch, protocol_version }`
    ///
    /// Только первая эпоха запускает инициализацию: остальные — это
    /// смена ключей внутри уже работающей сессии.
    pub fn prepare_epoch(&mut self, protocol_version: u16, epoch: u32) -> Result<(), String> {
        // Пока идёт повторная инициализация, новые эпохи игнорируем.
        if self.reinitializing() { return Ok(()); }

        // Только первая эпоха запускает инициализацию.
        if epoch != 1 { return Ok(()); }

        self.version = protocol_version;
        self.create_session()?;

        let key = match self.session.as_mut() {
            Some(session) => session
                .prepare_epoch(epoch, protocol_version)
                .map_err(err_str)?,
            None => None,
        };

        // Если сессия создала key-package — отправляем его наружу.
        if let Some(key) = key {
            (self.sink)(DaveEvent::Key(key));
        }
        Ok(())
    }

    /// Обработка proposals. Возвращает commit (+ welcome) для рассылки.
    ///
    /// `payload` — сериализованные предложения от другого участника.
    /// Первый байт — тип операции, остальное — сами предложения.
    pub fn process_proposals(&mut self, payload: &[u8], connected_clients: &[String]) -> Result<Option<Vec<u8>>, String> {
        let Some(session) = self.session.as_mut() else { return Ok(None) };
        if payload.is_empty() { return Ok(None); }

        let operation_type = payload[0];
        let result = session
            .process_proposals(operation_type, &payload[1..], Some(connected_clients.to_vec()))
            .map_err(err_str)?;
        let Some(commit) = result.commit else { return Ok(None) };

        // Склеиваем commit и welcome в один пакет: Discord ожидает
        // их вместе с префиксом `OPCODE_DAVE_MLS_WELCOME`.
        let mut out = commit;
        if let Some(welcome) = result.welcome {
            out.extend_from_slice(&welcome);
        }
        Ok(Some(out))
    }

    /// А transition_id из первых двух байт payload (big-endian).
    ///
    /// Используется, когда нативной сессии ещё нет: мы не можем
    /// обработать commit, но transition_id извлечь можем.
    fn fallback_transition_id(payload: &[u8]) -> u16 {
        if payload.len() >= 2 {
            u16::from_be_bytes([payload[0], payload[1]])
        } else {
            0
        }
    }

    /// Обработка commit. `(transition_id, success)`.
    ///
    /// Если нативная сессия нашла commit невалидным, она помечает
    /// переход как `invalidated`, и мы сообщаем об этом через `sink`.
    pub fn process_commit(&mut self, payload: &[u8]) -> Result<(u16, bool), String> {
        let Some(session) = self.session.as_mut() else {
            return Ok((Self::fallback_transition_id(payload), false));
        };

        let result = session
            .process_commit(payload)
            .map_err(err_str)?;

        if result.invalidated {
            (self.sink)(DaveEvent::InvalidateTransition(result.transition_id));
        }
        Ok((result.transition_id, result.success))
    }

    /// Обработка welcome. `(transition_id, success)`.
    ///
    /// Логика та же, что и для commit: welcome тоже может быть
    /// невалидным, и тогда мы сигналим наружу.
    pub fn process_welcome(&mut self, payload: &[u8]) -> Result<(u16, bool), String> {
        let Some(session) = self.session.as_mut() else {
            return Ok((Self::fallback_transition_id(payload), false));
        };

        let result = session
            .process_welcome(payload)
            .map_err(err_str)?;

        if result.invalidated {
            (self.sink)(DaveEvent::InvalidateTransition(result.transition_id));
        }
        Ok((result.transition_id, result.success))
    }

    /// Запускает нативную сессию заново.
    ///
    /// Создаёт сессию (если её нет), вызывает `reinit`, применяет
    /// отложенный external sender, отправляет key-package. Для версии 0
    /// дополнительно включает passthrough на ограниченное время.
    pub fn reinit(&mut self) -> Result<(), String> {
        if self.destroyed {
            return Ok(());
        }
        self.create_session()?;

        let result = match self.session.as_mut() {
            Some(session) => session.reinit().map_err(err_str)?,
            None => None,
        };

        if let Some(pending) = self.pending_external_sender.take() {
            if let Some(session) = self.session.as_mut() {
                session
                    .set_external_sender(&pending)
                    .map_err(err_str)?;
            }
        }

        if let Some(key) = result {
            (self.sink)(DaveEvent::Key(key));
        }

        // Для нулевой версии — режим без шифрования с ограничением по времени.
        if self.version == 0 {
            if let Some(session) = self.session.as_mut() {
                session.set_passthrough_mode(true, Some(TRANSITION_EXPIRY));
            }
        }
        Ok(())
    }

    /// Готовит переход. `true` — после него нужен `execute_transition`.
    ///
    /// Ненулевой `transition_id` означает, что переход требует
    /// подтверждения от других участников.
    pub fn prepare_transition(&mut self, transition_id: u16, protocol_version: u16) -> Result<bool, String> {
        self.create_session()?;
        Ok(match self.session.as_mut() {
            Some(session) => session.prepare_transition(transition_id, protocol_version),
            None => false,
        })
    }

    pub fn execute_transition(&mut self, transition_id: u16) -> bool {
        match self.session.as_mut() {
            Some(session) => session.execute_transition(transition_id),
            None => false,
        }
    }

    /// Шифрует пакеты; `None` — без шифрования / не готова / идёт переход.
    ///
    /// Для версии 0 возвращает пакеты как есть — E2EE выключен,
    /// шифровать нечем.
    pub fn encrypt(&mut self, packets: Vec<Vec<u8>>) -> Option<Vec<Vec<u8>>> {
        if self.version == 0 { return Some(packets); }

        let session = self.session.as_mut()?;
        if !session.ready() || session.is_transitioning() || session.reinitializing() {
            return None;
        }

        session.encrypt(packets)
    }

    /// Полностью уничтожает обёртку и нативную сессию (идемпотентно).
    pub fn destroy(&mut self) {
        if self.destroyed {
            return;
        }
        self.destroyed = true;

        if let Some(session) = self.session.as_mut() {
            session.destroy();
        }

        self.session = None;
        self.reinitializing_local = false;
        self.pending_external_sender = None;
        self.user_id.clear();
        self.channel_id.clear();
    }
}


/// Слой DAVE (MLS): сквозное шифрование голосовых пакетов (`DAVELayer`).
///
/// Управляет жизненным циклом `MlsWrapper`: создаёт, уничтожает,
/// предоставляет доступ к живой сессии и шифрует пакеты.
#[derive(Default)]
pub struct DaveLayer {
    /// Текущая обёртка. `None`, если сессия ещё не создана или уже
    /// уничтожена.
    client: Mutex<Option<MlsWrapper>>,
}
impl DaveLayer {
    /// Готовность: сессия есть, активна и не в переходе.
    ///
    /// Все три условия должны выполняться одновременно: иначе шифровать
    /// нельзя — получится либо мусор, либо устаревший ключ.
    pub fn ready(&self) -> bool {
        self.client
            .lock()
            .as_ref()
            .map(|c| c.status() == Some(STATUS_ACTIVE) && !c.is_transitioning() && !c.reinitializing())
            .unwrap_or(false)
    }

    /// Шифрует кадры; `None`, если сессии нет или шифровать нельзя.
    pub fn packet(&self, frames: Vec<Vec<u8>>) -> Option<Vec<Vec<u8>>> {
        self.client.lock().as_mut()?.encrypt(frames)
    }

    /// Выполняет `f` над живой (не уничтоженной) сессией.
    ///
    /// Если сессии нет или она уничтожена — возвращает `None`.
    /// Это защита от вызова методов на уже освобождённом объекте.
    pub fn with_live<R>(&self, f: impl FnOnce(&mut MlsWrapper) -> R) -> Option<R> {
        let mut guard = self.client.lock();
        match guard.as_mut() {
            Some(client) if !client.destroyed() => Some(f(client)),
            _ => None,
        }
    }

    /// Создаёт и инициализирует MLS-сессию (старая уничтожается).
    ///
    /// Настраивает `sink`, который будет отправлять key-package
    /// и invalid-transition пакеты в WebSocket.
    pub fn create(&self, version: u16, user_id: String, channel_id: String, ws: Arc<VoiceWebSocket>) -> Result<(), String> {
        // Уничтожаем старую сессию, если была. Делаем это под тем же
        // мьютексом, что и создание новой, чтобы не было окна, когда
        // слой пуст.
        let old = self.client.lock().take();
        if let Some(mut old) = old {
            old.destroy();
        }

        // Sink: key-package уходит как бинарный пакет с префиксом 26;
        // invalid-transition — как JSON с op 31.
        let sink: DaveSink = Arc::new(move |event| match event {
            // Выдача ключа
            DaveEvent::Key(key) => {
                let mut packet = Vec::with_capacity(key.len() + 1);
                packet.push(discord_opcode::DAVE_MLS_KEY_PACKAGE as u8);
                packet.extend_from_slice(&key);
                let _ = ws.send_binary(packet);
            }
            
            // Если не удалось выдать ключ
            DaveEvent::InvalidateTransition(transition_id) => {
                let payload = json!({
                    "op": discord_opcode::DAVE_MLS_INVALID_COMMIT_WELCOME,
                    "d": { "transition_id": transition_id }
                });
                let _ = ws.send_text(payload.to_string());
            }
        });

        // Один захват мьютекса: уничтожаем старую (ещё раз, на случай
        // гонки) и сразу кладём новую.
        let mut guard = self.client.lock();
        if let Some(mut old) = guard.take() {
            old.destroy();
        }
        let mut client = MlsWrapper::new(version, user_id, channel_id, sink);
        let result = client.reinit();
        *guard = Some(client);
        result
    }

    /// Уничтожает сессию, если она есть.
    pub fn destroy(&self) {
        let client = self.client.lock().take();
        if let Some(mut client) = client {
            client.destroy();
        }
    }
}