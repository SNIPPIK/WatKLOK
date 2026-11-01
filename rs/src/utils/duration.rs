use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

/// Длительность одного Opus-кадра, мс.
///
/// Единственный источник истины: от неё зависят период тика планировщика,
/// шаг RTP-timestamp и расчёт пропущенных кадров. Должна совпадать с
/// `-frame_duration` в аргументах FFmpeg (`audio::engine::constants`).
pub const FRAME_DURATION_MS: u64 = 20;

/// Длительность кадра в виде `Duration`.
pub const FRAME_DURATION: Duration = Duration::from_millis(FRAME_DURATION_MS);

/// Длительность кадра, мкс.
pub const FRAME_DURATION_US: u64 = FRAME_DURATION_MS * 1_000;

/// Монотонное время в миллисекундах с момента первого обращения к часам.
///
/// Не зависит от перевода системных часов и NTP-скачков. Точка отсчёта
/// общая с [`mono_us`]; значения из разных запусков процесса несравнимы.
pub fn mono_ms() -> u64 {
    start().elapsed().as_millis() as u64
}

/// Монотонное время в микросекундах (та же шкала, что и у [`mono_ms`]).
pub fn mono_us() -> u64 {
    start().elapsed().as_micros() as u64
}

/// Общая точка отсчёта; `OnceLock` инициализирует её ровно один раз.
#[inline]
fn start() -> Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    *START.get_or_init(Instant::now)
}