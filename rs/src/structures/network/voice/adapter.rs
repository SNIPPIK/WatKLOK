//! Данные `VoiceAdapter` (пакеты VOICE_SERVER_UPDATE / VOICE_STATE_UPDATE и
//! список клиентов канала). Сам gateway-адаптер находится снаружи.
//!
//! Разделение намеренное: gateway-слой владеет сетевым уровнем (открытие
//! gateway-соединения, подписка на события Discord), а голосовая часть
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
    pub server: Mutex<Option<ServerPacket>>,

    /// Последний `VOICE_STATE_UPDATE`.
    pub state: Mutex<Option<StatePacket>>,

    /// Пользователи в голосовом канале (для E2EE).
    pub clients: Mutex<SetArray>
}