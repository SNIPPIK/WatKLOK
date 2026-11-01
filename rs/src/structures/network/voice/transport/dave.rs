use crate::{
    discord::opcodes::discord_opcode,
    structures::{
        crypto::mls::{results::MlsError, session::MlsSession as Native},
        network::ws::VoiceWebSocket
    }
};
use {
    parking_lot::Mutex,
    serde_json::json,
    std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc
    }
};

/// Максимальная поддерживаемая версия протокола DAVE.
pub const MAX_DAVE_PROTOCOL: u16 = 1;

/// Время жизни режима passthrough при отключении E2EE.
const TRANSITION_EXPIRY: u32 = 10;

/// Статус нативной MLS-сессии, при котором она готова шифровать.
const STATUS_ACTIVE: u8 = 3;

/// События обёртки MLS.
pub enum DaveEvent {
    /// Новый key-package для отправки с opcode 26.
    Key(Vec<u8>),

    /// Невалидный переход для отправки с opcode 31.
    InvalidateTransition(u16),
}

/// Обработчик событий MLS.
pub type DaveSink = Arc<dyn Fn(DaveEvent) + Send + Sync>;

/// Преобразует ошибку MLS в строку.
fn err_str(e: MlsError) -> String {
    e.to_string()
}

/// Обёртка над нативной MLS-сессией.
pub struct MlsWrapper {
    /// Текущая версия протокола.
    version: u16,

    /// Идентификатор текущего пользователя.
    user_id: String,

    /// Идентификатор голосового канала.
    channel_id: String,

    /// Флаг уничтожения обёртки.
    destroyed: bool,

    /// External sender, отложенный до создания сессии.
    pending_external_sender: Option<Vec<u8>>,

    /// Нативная MLS-сессия.
    session: Option<Native>,

    /// Обработчик событий.
    sink: DaveSink,
}

impl MlsWrapper {
    /// Создаёт обёртку без нативной сессии.
    pub fn new(
        version: u16,
        user_id: String,
        channel_id: String,
        sink: DaveSink,
    ) -> Self {
        Self {
            version,
            user_id,
            channel_id,
            destroyed: false,
            pending_external_sender: None,
            session: None,
            sink,
        }
    }

    /// Проверяет, уничтожена ли обёртка или нативная сессия.
    pub fn destroyed(&self) -> bool {
        self.destroyed
            || self
            .session
            .as_ref()
            .map(|s| s.destroyed())
            .unwrap_or(false)
    }

    /// Возвращает статус нативной сессии.
    pub fn status(&self) -> Option<u8> {
        self.session.as_ref().and_then(|s| s.status())
    }

    /// Проверяет, выполняется ли переход.
    pub fn is_transitioning(&self) -> bool {
        self.session
            .as_ref()
            .map(|s| s.is_transitioning())
            .unwrap_or(false)
    }

    /// Проверяет, выполняется ли повторная инициализация.
    pub fn reinitializing(&self) -> bool {
        self.session
            .as_ref()
            .map(|s| s.reinitializing())
            .unwrap_or(false)
    }

    /// Создаёт нативную сессию при необходимости.
    ///
    /// Также применяет external sender, если он пришёл заранее.
    fn create_session(&mut self) -> Result<(), String> {
        if self.session.is_some() {
            return Ok(());
        }

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

    /// Устанавливает external sender.
    ///
    /// Если сессия ещё не создана, откладывает применение данных.
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

    /// Обрабатывает подготовку эпохи.
    ///
    /// Только epoch = 1 запускает первоначальную инициализацию.
    pub fn prepare_epoch(
        &mut self,
        protocol_version: u16,
        epoch: u32,
    ) -> Result<(), String> {
        if self.reinitializing() {
            return Ok(());
        }

        if epoch != 1 {
            return Ok(());
        }

        self.version = protocol_version;
        self.create_session()?;

        let key = match self.session.as_mut() {
            Some(session) => session
                .prepare_epoch(epoch, protocol_version)
                .map_err(err_str)?,

            None => None,
        };

        if let Some(key) = key {
            (self.sink)(DaveEvent::Key(key));
        }

        Ok(())
    }

    /// Обрабатывает proposals и возвращает COMMIT/WELCOME,
    /// который должен быть отправлен голосовому шлюзу.
    ///
    /// Первый байт payload — тип операции:
    /// 0 = APPEND, 1 = REVOKE.
    ///
    /// В список распознаваемых пользователей добавляется собственный
    /// user_id, поскольку список подключённых клиентов не обязательно
    /// содержит текущего пользователя.
    pub fn process_proposals(
        &mut self,
        payload: &[u8],
        connected_clients: &[String],
    ) -> Result<Option<Vec<u8>>, String> {
        if payload.is_empty() {
            return Ok(None);
        }

        // Формируем полный список распознаваемых участников.
        let mut recognized_user_ids = connected_clients.to_vec();

        if !recognized_user_ids
            .iter()
            .any(|id| id == &self.user_id)
        {
            recognized_user_ids.push(self.user_id.clone());
        }

        let Some(session) = self.session.as_mut() else {
            return Ok(None);
        };

        let operation_type = payload[0];

        let result = session
            .process_proposals(
                operation_type,
                &payload[1..],
                Some(recognized_user_ids),
            )
            .map_err(err_str)?;

        let Some(commit) = result.commit else {
            return Ok(None);
        };

        // Discord ожидает COMMIT и необязательный WELCOME
        // в одном бинарном сообщении с opcode 28.
        let mut out = commit;

        if let Some(welcome) = result.welcome {
            out.extend_from_slice(&welcome);
        }

        Ok(Some(out))
    }

    /// Извлекает transition_id из первых двух байтов payload.
    ///
    /// Используется, если нативная сессия ещё не существует.
    fn fallback_transition_id(payload: &[u8]) -> u16 {
        if payload.len() >= 2 {
            u16::from_be_bytes([payload[0], payload[1]])
        } else {
            0
        }
    }

    /// Обрабатывает COMMIT.
    ///
    /// Возвращает transition_id и признак успешной обработки.
    pub fn process_commit(
        &mut self,
        payload: &[u8],
    ) -> Result<(u16, bool), String> {
        let Some(session) = self.session.as_mut() else {
            return Ok((Self::fallback_transition_id(payload), false));
        };

        let result = session
            .process_commit(payload)
            .map_err(err_str)?;

        if result.invalidated {
            (self.sink)(DaveEvent::InvalidateTransition(
                result.transition_id,
            ));
        }

        Ok((result.transition_id, result.success))
    }

    /// Обрабатывает WELCOME.
    ///
    /// Возвращает transition_id и признак успешной обработки.
    pub fn process_welcome(
        &mut self,
        payload: &[u8],
    ) -> Result<(u16, bool), String> {
        let Some(session) = self.session.as_mut() else {
            return Ok((Self::fallback_transition_id(payload), false));
        };

        let result = session
            .process_welcome(payload)
            .map_err(err_str)?;

        if result.invalidated {
            (self.sink)(DaveEvent::InvalidateTransition(
                result.transition_id,
            ));
        }

        Ok((result.transition_id, result.success))
    }

    /// Повторно инициализирует нативную сессию.
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

        if self.version == 0 {
            if let Some(session) = self.session.as_mut() {
                session.set_passthrough_mode(
                    true,
                    Some(TRANSITION_EXPIRY),
                );
            }
        }

        Ok(())
    }

    /// Подготавливает переход протокола.
    ///
    /// Возвращает true, если требуется отдельный EXECUTE_TRANSITION.
    pub fn prepare_transition(
        &mut self,
        transition_id: u16,
        protocol_version: u16,
    ) -> Result<bool, String> {
        self.create_session()?;

        Ok(match self.session.as_mut() {
            Some(session) => {
                session.prepare_transition(
                    transition_id,
                    protocol_version,
                )
            }

            None => false,
        })
    }

    /// Выполняет подготовленный переход.
    pub fn execute_transition(&mut self, transition_id: u16) -> bool {
        match self.session.as_mut() {
            Some(session) => session.execute_transition(transition_id),
            None => false,
        }
    }

    /// Шифрует кадры для отправки.
    ///
    /// Возвращает зашифрованные кадры и число кадров, которые отправить
    /// нельзя (E2EE ещё не готово или идёт повторная инициализация): без
    /// шифрования отправлять нельзя, поэтому они теряются, но не молча.
    pub fn encrypt(
        &mut self,
        packets: Vec<Vec<u8>>,
    ) -> (Vec<Vec<u8>>, usize) {
        // Версия 0 — E2EE выключено, кадры идут как есть.
        if self.version == 0 {
            return (packets, 0);
        }

        let total = packets.len();

        let Some(session) = self.session.as_mut() else {
            return (Vec::new(), total);
        };

        if !session.ready()
            || session.is_transitioning()
            || session.reinitializing()
        {
            return (Vec::new(), total);
        }

        session.encrypt(packets)
    }

    /// Уничтожает обёртку и нативную сессию.
    pub fn destroy(&mut self) {
        if self.destroyed {
            return;
        }

        self.destroyed = true;

        if let Some(session) = self.session.as_mut() {
            session.destroy();
        }

        self.session = None;
        self.pending_external_sender = None;
        self.user_id.clear();
        self.channel_id.clear();
    }
}

/// Слой DAVE: управление MLS-сессией и шифрованием голосовых пакетов.
#[derive(Default)]
pub struct DaveLayer {
    /// Текущая MLS-обёртка.
    client: Mutex<Option<MlsWrapper>>,

    /// Явно установленный режим без E2EE.
    passthrough: AtomicBool,
}

impl DaveLayer {
    /// Проверяет готовность DAVE.
    pub fn ready(&self) -> bool {
        if self.passthrough.load(Ordering::Acquire) {
            return true;
        }

        self.client
            .lock()
            .as_ref()
            .map(|c| {
                c.status() == Some(STATUS_ACTIVE)
                    && !c.is_transitioning()
                    && !c.reinitializing()
            })
            .unwrap_or(false)
    }

    /// Шифрует кадры (или пропускает как есть в режиме passthrough).
    ///
    /// Возвращает кадры для отправки и число потерянных (см.
    /// `MlsWrapper::encrypt`).
    pub fn packet(&self, frames: Vec<Vec<u8>>) -> (Vec<Vec<u8>>, usize) {
        if self.passthrough.load(Ordering::Acquire) {
            return (frames, 0);
        }

        let total = frames.len();

        match self.client.lock().as_mut() {
            Some(client) => client.encrypt(frames),
            None => (Vec::new(), total),
        }
    }

    /// Включает или выключает passthrough.
    ///
    /// При включении старую MLS-сессию необходимо уничтожить.
    pub fn set_passthrough(&self, enabled: bool) {
        if enabled {
            self.destroy();
        }

        self.passthrough.store(enabled, Ordering::Release);
    }

    /// Выполняет операцию над существующей сессией.
    pub fn with_live<R>(
        &self,
        f: impl FnOnce(&mut MlsWrapper) -> R,
    ) -> Option<R> {
        let mut guard = self.client.lock();

        match guard.as_mut() {
            Some(client) if !client.destroyed() => Some(f(client)),
            _ => None,
        }
    }

    /// Создаёт новую MLS-сессию, заменяя предыдущую.
    ///
    /// События key-package и invalid-transition отправляются
    /// через переданный WebSocket.
    pub fn create(
        &self,
        version: u16,
        user_id: String,
        channel_id: String,
        ws: Arc<VoiceWebSocket>,
    ) -> Result<(), String> {
        self.passthrough.store(false, Ordering::Release);

        let sink: DaveSink = Arc::new(move |event| match event {
            DaveEvent::Key(key) => {
                let mut packet = Vec::with_capacity(key.len() + 1);

                packet.push(
                    discord_opcode::dave::DAVE_MLS_KEY_PACKAGE as u8,
                );

                packet.extend_from_slice(&key);
                let _ = ws.send_binary(packet);
            }

            DaveEvent::InvalidateTransition(transition_id) => {
                let payload = json!({
                    "op": discord_opcode::dave::DAVE_MLS_INVALID_COMMIT_WELCOME,
                    "d": {
                        "transition_id": transition_id
                    }
                });

                let _ = ws.send_text(payload.to_string());
            }
        });

        let mut guard = self.client.lock();

        if let Some(mut old) = guard.take() {
            old.destroy();
        }

        let mut client = MlsWrapper::new(
            version,
            user_id,
            channel_id,
            sink,
        );

        // match — хвостовое выражение функции: его тип Result<(), String>
        // и есть возвращаемое значение.
        match client.reinit() {
            Ok(()) => {
                *guard = Some(client);
                Ok(())
            }
            Err(e) => {
                // Освобождаем частично созданную MLS-сессию и sink
                // (последний держит Arc<VoiceWebSocket>).
                client.destroy();
                Err(e)
            }
        }
    }

    /// Уничтожает текущую MLS-сессию.
    pub fn destroy(&self) {
        self.passthrough.store(false, Ordering::Release);

        let client = self.client.lock().take();

        if let Some(mut client) = client {
            client.destroy();
        }
    }
}