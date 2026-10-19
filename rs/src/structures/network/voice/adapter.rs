//! Данные `VoiceAdapter` (пакеты VOICE_SERVER_UPDATE / VOICE_STATE_UPDATE и
//! список клиентов канала). Сам gateway-адаптер остаётся в JS.
//!
//! Разделение намеренное: JS-сторона владеет сетевым слоем (открытие
//! gateway-соединения, подписка на события Discord), а нативная часть
//! получает уже разобранные пакеты и хранит их в общем состоянии.

use crate::utils::array::SetArray;
use parking_lot::Mutex;
use std::fmt;

/// Пакет `VOICE_SERVER_UPDATE`.
///
/// Содержит данные для подключения к голосовому серверу: токен,
/// идентификатор гильдии и endpoint (адрес сервера).
///
/// `Debug` реализован вручную: токен скрыт, чтобы он не попал в логи.
#[derive(Clone)]
pub struct ServerPacket {
    /// Токен для аутентификации на голосовом сервере.
    pub token: String,

    /// Идентификатор гильдии, к которой относится соединение.
    pub guild_id: String,

    /// Адрес голосового сервера. `None`, если сервер ещё не прислал endpoint.
    pub endpoint: Option<String>
}

impl fmt::Debug for ServerPacket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServerPacket")
            .field("token", &"<redacted>")
            .field("guild_id", &self.guild_id)
            .field("endpoint", &self.endpoint)
            .finish()
    }
}

/// Пакет `VOICE_STATE_UPDATE`.
///
/// Содержит данные о текущем голосовом состоянии клиента.
///
/// `Debug` реализован вручную: `session_id` скрыт.
#[derive(Clone)]
pub struct StatePacket {
    /// Идентификатор гильдии. `None` для личных сообщений.
    pub guild_id: Option<String>,

    /// Идентификатор пользователя.
    pub user_id: String,

    /// Идентификатор сессии — нужен для аутентификации на голосовом сервере.
    pub session_id: String,

    /// Идентификатор канала. `None`, если пользователь вышел из канала.
    pub channel_id: Option<String>
}

impl fmt::Debug for StatePacket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StatePacket")
            .field("guild_id", &self.guild_id)
            .field("user_id", &self.user_id)
            .field("session_id", &"<redacted>")
            .field("channel_id", &self.channel_id)
            .finish()
    }
}

/// Общее состояние адаптера, разделяемое `VoiceConnection` и `Transport`.
///
/// Все поля обёрнуты в `Mutex`, потому что доступ идёт из разных потоков.
/// `parking_lot::Mutex` быстрее стандартного и не отравляется при панике.
///
/// Если коду нужны `server` и `state` одновременно, берите локи в порядке
/// `server` -> `state` -> `clients`, чтобы не получить взаимную блокировку.
#[derive(Default)]
pub struct AdapterData {
    /// Последний `VOICE_SERVER_UPDATE`.
    ///
    /// `None`, пока сервер не прислал данные для подключения.
    /// Заполняется при получении пакета, читается транспортом при
    /// открытии WebSocket-соединения.
    pub server: Mutex<Option<ServerPacket>>,

    /// Последний `VOICE_STATE_UPDATE`.
    ///
    /// `None`, пока клиент не получил подтверждение состояния.
    /// Заполняется при получении пакета, читается для проверки,
    /// в каком канале сейчас находится клиент.
    pub state: Mutex<Option<StatePacket>>,

    /// Пользователи в голосовом канале (для E2EE).
    ///
    /// `SetArray` используется, чтобы быстро проверять наличие
    /// пользователя и не хранить дубликаты. Список нужен
    /// MLS-сессии для построения дерева ключей.
    pub clients: Mutex<SetArray>
}