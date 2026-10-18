use std::time::{SystemTime, UNIX_EPOCH};

/// Текущее время в миллисекундах от UNIX-эпохи (аналог `Date.now()`).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}