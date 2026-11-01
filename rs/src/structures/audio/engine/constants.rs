//! Константы движка.

/// Размер одного чтения из stdout (8 КиБ).
///
/// Небольшая порция означает, что разборщик отдаёт в буфер несколько
/// пакетов за раз, а не всю накопившуюся в pipe пачку одним залпом.
/// `BufReader` не используется: промежуточный буфер только добавил бы
/// лишнее копирование.
pub const AUDIO_READ_CHUNK: usize = 8 * 1024;

/// Начальная ёмкость вектора готовых пакетов.
/// Вектор создаётся один раз и используется повторно, поэтому выделение
/// памяти под него происходит однократно.
pub const AUDIO_FRAMES_CAPACITY: usize = 128;

/// Максимальный размер незавершённых данных в разборщике Ogg (8 МБ).
///
/// Защищает от бесконечного роста при повреждённом или бесконечно длинном входе.
pub(crate) const MAX_PARSER_PENDING: usize = 8 * 1024 * 1024;

/// Флаги, добавляемые к FFmpeg перед пользовательскими аргументами.
///
/// Убирают лишний вывод и чтение из stdin:
/// - `-vn` — отключить видео;
/// - `-loglevel error` — выводить только ошибки;
/// - `-nostdin` — не читать stdin;
/// - `-hide_banner` — скрыть баннер FFmpeg;
/// - `-protocol_whitelist` — разрешённые протоколы входа. Без него ffmpeg
///   откроет и `concat:`, `subfile:` и прочее, что может прийти в `-i` из
///   пользовательских данных (чтение локальных файлов, SSRF). Нужен ещё
///   протокол (например, `rtmp`) — добавьте его сюда.
pub(crate) const FFMPEG_PREFIX: &[&str] = &[
    "-protocol_whitelist",  "file,pipe,http,https,tcp,tls,crypto,data",
    "-vn",
    "-loglevel", "error",
    "-nostdin",
    "-analyzeduration",     "200",
    "-probesize",           "32",
    "-hide_banner",
];

/// Флаги длительности аудио кадра Opus, передаваемые FFmpeg.
///
/// `-frame_duration 20` — длительность одного кадра 20 мс. Должна совпадать
/// с `FRAME_DURATION_MS`: на ней держатся тик планировщика и шаг
/// RTP-timestamp (проверяется тестом ниже).
pub(crate) const FFMPEG_TIME_CODER: &[&str] = &[
    "-frame_duration", "20"
];

/// Флаги авто-переподключения, вставляемые перед `-i http...`.
///
/// Используются только для сетевых источников:
/// - `-reconnect 1` — включить переподключение;
/// - `-reconnect_streamed 1` — переподключение для потоковых входов;
/// - `-reconnect_delay_max 5` — максимальная пауза между попытками (сек);
/// - `-reconnect_on_network_error 1` — переподключаться при сетевых ошибках.
pub(crate) const RECONNECT_FLAGS: &[&str] = &[
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-reconnect_on_network_error", "1",
];

/// Начало выходных флагов FFmpeg: кодек Opus.
///
/// `-c:a libopus` — выбрать аудиокодек Opus для выходного потока.
/// Длительность кадра (`-frame_duration`) задаётся отдельной константой
/// `FFMPEG_TIME_CODER`.
pub(crate) const OUTPUT_SUFFIX_HEAD: &[&str] = &["-c:a", "libopus"];

/// Конец выходных флагов FFmpeg: формат Ogg и вывод в stdout.
///
/// `pipe:1` используется, чтобы FFmpeg писал Ogg/Opus прямо в stdout,
/// откуда его читает reader-поток.
pub(crate) const OUTPUT_SUFFIX_TAIL: &[&str] = &["-f", "ogg", "pipe:1"];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::duration::FRAME_DURATION_MS;

    #[test]
    fn ffmpeg_frame_duration_matches_scheduler_frame() {
        assert_eq!(FFMPEG_TIME_CODER[0], "-frame_duration");
        assert_eq!(FFMPEG_TIME_CODER[1], FRAME_DURATION_MS.to_string());
    }
}
