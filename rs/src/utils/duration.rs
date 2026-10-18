//! Общие мелочи голосового модуля.

use std::time::{SystemTime, UNIX_EPOCH};

/// Текущее время в миллисекундах от UNIX-эпохи (аналог `Date.now()`).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Коды закрытия Discord Voice (`VoiceCloseCodes` из discord-api-types),
/// которые использует транспорт.
pub mod close_code {
    /// Нормальное закрытие WebSocket.
    pub const NORMAL: u32 = 1000;
    /// `VoiceCloseCodes.ServerNotFound`.
    pub const SERVER_NOT_FOUND: u32 = 4011;
    /// `VoiceCloseCodes.Disconnected`.
    pub const DISCONNECTED: u32 = 4014;
    /// `VoiceCloseCodes.VoiceServerCrashed`.
    pub const VOICE_SERVER_CRASHED: u32 = 4015;
    /// `VoiceCloseCodes.BadRequest`.
    pub const BAD_REQUEST: u32 = 4020;
    /// `VoiceCloseCodes.CallTerminated`.
    pub const CALL_TERMINATED: u32 = 4022;
}
