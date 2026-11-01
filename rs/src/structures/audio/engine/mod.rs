//! Движок аудио-буфера поверх процесса FFmpeg.
//!
//! Модуль разбит на части по ответственности:
//! * [`constants`] — константы (флаги FFmpeg, лимиты парсера);
//! * [`start`] — запуск FFmpeg и потока чтения;
//! * [`reader`]— тело фонового потока чтения stdout;
//! * [`lifecycle`] — уничтожение и `Drop`;
//! * [`buffer_ops`] — операции над очередью пакетов и позицией.

mod buffer_ops;
mod constants;
mod lifecycle;
mod reader;
mod start;

use crate::structures::audio::ring::packet_queue::PacketQueue;
use {
    napi_derive::napi,
    std::{
        process::Child,
        sync::{
            atomic::{AtomicBool, AtomicUsize},
            Arc, Condvar, Mutex,
        },
        thread::JoinHandle,
    }
};

/// Верхняя граница `max_minutes`: 240 мин = 720 000 пакетов. Это только
/// предел по количеству: память под пакеты выделяется по мере поступления.
const MAX_BUFFER_MINUTES: u32 = 240;

/// Движок аудио-буфера, связанный с процессом FFmpeg и потоком чтения.
///
/// Управляет жизненным циклом дочернего процесса FFmpeg и фонового потока,
/// который читает его stdout, разбирает Ogg/Opus и складывает готовые
/// аудио-пакеты в очередь `PacketQueue`. Операции над буфером и позицией
/// вынесены в отдельные модули (`buffer_ops`, `lifecycle`, `start`, `reader`).
#[napi]
pub struct AudioEngine {
    /// Дочерний процесс FFmpeg. Мьютекс нужен для безопасного доступа и kill.
    ///
    /// Лежит в `Arc`, потому что reader при самостоятельном завершении
    /// (EOF/ошибка) сам убивает и `wait()`-ит процесс — иначе ffmpeg
    /// остаётся зомби до явного `destroy()`.
    pub(crate) child: Arc<Mutex<Option<Child>>>,

    /// Флаг активности потока чтения. `true` — поток работает.
    pub(crate) reading_active: Arc<AtomicBool>,

    /// Флаг уничтожения движка. После `true` дальнейшие операции запрещены.
    pub(crate) destroyed: Arc<AtomicBool>,

    /// Дескриптор потока чтения. Хранится в мьютексе для join при остановке.
    pub(crate) reader_handle: Mutex<Option<JoinHandle<()>>>,

    /// Состояние паузы: (флаг паузы, condvar для пробуждения).
    ///
    /// Поток чтения проверяет флаг и засыпает на condvar, пока пауза активна.
    pub(crate) pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Очередь Opus-пакетов и condvar, на котором reader ждёт свободного
    /// места.
    ///
    /// Reader наполняет буфер, consumer (JS) извлекает пакеты через
    /// `get_packets` и после этого будит reader.
    pub(crate) buffer: Arc<(Mutex<PacketQueue>, Condvar)>,

    /// Максимальная ёмкость буфера (число пакетов).
    pub(crate) max_capacity: usize,

    /// Позиция чтения (количество извлечённых пакетов).
    pub(crate) position: Arc<AtomicUsize>,

    /// Сериализует процесс уничтожения.
    ///
    /// Нужен для того, чтобы конкурентные вызовы `destroy()`
    /// не возвращались до фактического завершения первого destroy.
    destroy_lock: Mutex<()>
}

#[napi]
impl AudioEngine {
    /// Создаёт движок с буфером заданной ёмкости.
    ///
    /// Предел очереди — `50 пакетов/с * 60 с * минуты`, где минуты ограничены
    /// диапазоном `5..=MAX_BUFFER_MINUTES` (то есть от 15 000 пакетов,
    /// 5 минут звука). Память занимается по мере поступления пакетов.
    ///
    /// # Аргументы
    /// * `max_minutes` — максимальная длительность аудио в минутах.
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        let capacity = (50u32 * 60)
            .saturating_mul(max_minutes.clamp(5, MAX_BUFFER_MINUTES))
            as usize;

        Self {
            // Процесс FFmpeg ещё не запущен.
            child: Arc::new(Mutex::new(None)),

            // Reader неактивен до вызова start().
            reading_active: Arc::new(AtomicBool::new(false)),

            // Движок не уничтожен.
            destroyed: Arc::new(AtomicBool::new(false)),

            // Handle потока отсутствует.
            reader_handle: Mutex::new(None),

            // Пауза снята, condvar инициализирован.
            pause_state: Arc::new((Mutex::new(false), Condvar::new())),

            // Очередь пакетов с рассчитанным пределом + condvar.
            buffer: Arc::new((Mutex::new(PacketQueue::new(capacity)), Condvar::new())),

            // Максимальная ёмкость = ёмкость буфера.
            max_capacity: capacity,

            // Позиция чтения начинается с нуля.
            position: Arc::new(AtomicUsize::new(0)),

            destroy_lock: Mutex::new(())
        }
    }
}