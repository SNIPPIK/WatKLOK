use crate::discord::opcodes::discord_opcode;

pub mod ws_codes {
    /// Статусы WebSocket-соединения.
    ///
    /// Соответствуют стандартным состояниям `WebSocket.readyState` из браузера.
    /// Используются в `VoiceWebSocket` для геттера `status`.
    pub mod status {
        /// Устанавливается соединение (handshake в процессе).
        pub const CONNECTING: u8 = 0;

        /// Соединение открыто и готово к обмену данными.
        pub const OPEN: u8 = 1;

        /// Соединение закрывается.
        pub const CLOSING: u8 = 2;

        /// Соединение закрыто.
        pub const CLOSED: u8 = 3;
    }

    /// Коды закрытия соединения, специфичные для Discord Voice.
    ///
    /// # Структура кодов
    ///
    /// * `1000` — стандартный WebSocket-код нормального закрытия.
    ///   Используется в `STOP_CODES`: если сервер закрывает соединение
    ///   с этим кодом, переподключаться бессмысленно.
    ///
    /// * `4009..4022` — коды Discord Voice Gateway. Префикс `40` означает
    ///   «ошибка уровня приложения» (не WebSocket-протокола). Каждый код
    ///   соответствует конкретной проблеме, и вызывающий код может
    ///   различать их: например, `CALL_TERMINATED` — штатное завершение,
    ///   `SERVER_NOT_FOUND` — проблема с endpoint, `SESSION_TIMEOUT` —
    ///   пропущенный heartbeat.
    pub mod close {
        /// Нормальное закрытие WebSocket.
        ///
        /// Стандартный код протокола WebSocket (RFC 6455). Означает, что
        /// соединение закрыто штатно, без ошибок.
        pub const NORMAL: u32 = 1000;

        /// Session timeout (в т.ч. пропущенный HEARTBEAT_ACK).
        ///
        /// Сервер закрывает соединение, если не получил heartbeat-ACK
        /// вовремя. Это не проблема клиента по сути — просто пропуск,
        /// но переподключение потребуется.
        pub const SESSION_TIMEOUT: u32 = 4009;

        /// `VoiceCloseCodes::ServerNotFound`.
        ///
        /// Endpoint, к которому мы пытались подключиться, не существует
        /// или недоступен. Обычно означает, что данные VOICE_SERVER_UPDATE
        /// были неверными.
        pub const SERVER_NOT_FOUND: u32 = 4011;

        /// `VoiceCloseCodes::Disconnected`.
        ///
        /// Пользователь намеренно отключился от канала. Один из `STOP_CODES`:
        /// переподключаться не нужно.
        pub const DISCONNECTED: u32 = 4014;

        /// `VoiceCloseCodes::VoiceServerCrashed`.
        ///
        /// Голосовой сервер упал. Обычно означает, что стоит попробовать
        /// другое подключение — endpoint мог измениться.
        pub const VOICE_SERVER_CRASHED: u32 = 4015;

        /// `VoiceCloseCodes::BadRequest`.
        ///
        /// Некорректный запрос: обычно неверный Identify или Select Protocol.
        /// Переподключаться бессмысленно — ошибка не исправится сама.
        pub const BAD_REQUEST: u32 = 4020;

        /// `VoiceCloseCodes::CallTerminated`.
        ///
        /// Звонок завершён. Используется как код причины в `TransportEvent::Destroyed`,
        /// когда транспорт уничтожается штатно (не по ошибке).
        pub const CALL_TERMINATED: u32 = 4022;
    }
}

/// Проверяет, относится ли op-код к диапазону DAVE.
///
/// Удобная функция-обёртка над [`discord_opcode::dave::is_dave`] для использования
/// без явного указания модуля.
#[inline]
pub fn is_dave(code: u64) -> bool {
    discord_opcode::dave::is_dave(code)
}