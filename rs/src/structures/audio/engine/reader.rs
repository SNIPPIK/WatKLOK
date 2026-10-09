//! Тело фонового потока чтения stdout FFmpeg.
//!
//! Функция полностью самодостаточна: не хранит ссылок на `AudioEngine`,
//! получает только `Arc`-и на общие состояния. Это позволяет тестировать
//! её отдельно и упрощает вынос в отдельный модуль.

use super::constants::MAX_PARSER_PENDING;
use crate::structures::audio::{encoder::ogg::OggOpusDemuxer, ring_buffer::RingBuffer};
use std::{
    io::{ErrorKind, Read},
    process::{Child, ChildStdout},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
};

/// Размер одного чтения из stdout.
///
/// Равен ёмкости pipe в Linux, поэтому один `read()` забирает всё, что
/// накопилось. Читаем напрямую в этот буфер, без `BufReader`: раньше буфер
/// чтения (16 КиБ) был меньше внутреннего буфера `BufReader` (64 КиБ), и
/// каждый байт копировался дважды без какой-либо пользы.
const READ_CHUNK: usize = 64 * 1024;

/// Начальная ёмкость вектора готовых пакетов (растёт один раз и переиспользуется).
const FRAMES_CAPACITY: usize = 128;

/// Проверяет, нужно ли остановить reader.
#[inline]
fn should_stop(active: &AtomicBool, destroyed: &AtomicBool) -> bool {
    !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire)
}

/// Убивает и `wait()`-ит процесс FFmpeg, если он ещё не забран.
///
/// `std::process::Child` при `Drop` НЕ делает ни `kill`, ни `wait`, поэтому
/// без явного `wait()` завершившийся ffmpeg остаётся зомби.
///
/// `kill` на уже завершившемся процессе безвреден; `wait` после `kill`
/// не блокируется. Сам `wait` выполняется вне мьютекса.
fn reap_child(child: &Mutex<Option<Child>>) {
    let process = child.lock().unwrap_or_else(|p| p.into_inner()).take();

    if let Some(mut process) = process {
        let _ = process.kill();
        let _ = process.wait();
    }
}

/// RAII-финализатор потока: отрабатывает при ЛЮБОМ выходе из `reader_loop`,
/// включая панику (раскрутку стека).
///
/// Порядок действий важен:
/// 1. `reap_child` — ffmpeg не остаётся зомби;
/// 2. `active = false` — ПОСЛЕДНЕЕ действие. Повторный `start()` проходит
///    только после `active == false`, поэтому к этому моменту старый reader
///    уже не может «увести» (reap-нуть) чужой, новый процесс.
///
/// stdout к этому моменту уже закрыт (его владелец — `read_and_demux`,
/// вернувшийся раньше), так что ffmpeg, пишущий в полный pipe, получит EPIPE
/// и не будет зависать, даже если `kill` по какой-то причине не сработает.
struct ReaderCleanup<'a> {
    child: &'a Mutex<Option<Child>>,
    active: &'a AtomicBool,
}

impl Drop for ReaderCleanup<'_> {
    fn drop(&mut self) {
        reap_child(self.child);
        self.active.store(false, Ordering::Release);
    }
}

/// RAII-уведомление consumer'а: если в буфер попал хотя бы один пакет,
/// при дропе (в том числе при раннем `return`) выполняется `notify_one()`.
///
/// Объявляется ДО guard'а мьютекса, поэтому дропается ПОСЛЕ него: consumer
/// будится уже без удерживаемого лока и не упирается сразу в занятый мьютекс.
struct NotifyOnDrop<'a> {
    cvar: &'a Condvar,
    pending: bool,
}

impl NotifyOnDrop<'_> {
    /// Будит consumer'а немедленно, если есть не объявленные им пакеты.
    #[inline]
    fn flush(&mut self) {
        if self.pending {
            self.cvar.notify_one();
            self.pending = false;
        }
    }
}

impl Drop for NotifyOnDrop<'_> {
    #[inline]
    fn drop(&mut self) {
        self.flush();
    }
}

/// Читает stdout FFmpeg, демультиплексирует Ogg/Opus и складывает аудио-пакеты
/// в кольцевой буфер.
///
/// Завершается, когда:
/// * `active` сброшен;
/// * `destroyed` выставлен;
/// * FFmpeg закрыл stdout (EOF) — после обязательного flush последнего пакета;
/// * произошла ошибка чтения (кроме `Interrupted`, который ретраится) или
///   ошибка парсинга;
/// * парсер переполнен;
/// * кольцевой буфер отверг пакет или его мьютекс отравлен.
///
/// При выходе (в том числе при панике) процесс FFmpeg гарантированно
/// убивается и reap-ится, после чего сбрасывается `active`.
///
/// # Аргументы
/// * `stdout` — piped stdout процесса FFmpeg.
/// * `active` — флаг активности reader'а.
/// * `destroyed` — флаг уничтожения движка.
/// * `pause_state` — состояние паузы (флаг + condvar).
/// * `buffer_state` — кольцевой буфер + condvar для ожидания места/данных.
/// * `child` — процесс FFmpeg; reader убивает и reap-ит его при выходе.
pub(crate) fn reader_loop(
    stdout: ChildStdout,
    active: Arc<AtomicBool>,
    destroyed: Arc<AtomicBool>,
    pause_state: Arc<(Mutex<bool>, Condvar)>,
    buffer_state: Arc<(Mutex<RingBuffer>, Condvar)>,
    child: Arc<Mutex<Option<Child>>>,
) {
    // Объявлен первым → дропается последним: к моменту его срабатывания
    // `read_and_demux` уже вернулся, а значит stdout закрыт, а парсер и
    // буферы освобождены.
    let _cleanup = ReaderCleanup {
        child: &*child,
        active: &*active,
    };

    read_and_demux(stdout, &active, &destroyed, &pause_state, &buffer_state);
}

/// Основной цикл. Владеет stdout, парсером и временными буферами; при любом
/// выходе (`return` или паника) всё это освобождается ДО срабатывания
/// `ReaderCleanup`.
fn read_and_demux(
    mut stdout: ChildStdout,
    active: &AtomicBool,
    destroyed: &AtomicBool,
    pause_state: &(Mutex<bool>, Condvar),
    buffer_state: &(Mutex<RingBuffer>, Condvar),
) {
    // Демультиплексор Ogg/Opus, собирает аудио-пакеты из байтового потока.
    let mut parser = OggOpusDemuxer::new();

    // Буфер для одного чтения из stdout (на куче — не зависим от размера стека потока).
    let mut read_buf = vec![0u8; READ_CHUNK];

    // Переиспользуемый вектор для парсинга (избегаем аллокаций в цикле).
    let mut frames = Vec::with_capacity(FRAMES_CAPACITY);

    loop {
        // Проверка остановки: один из флагов мог быть сброшен извне.
        if should_stop(active, destroyed) {
            return;
        }

        // Обработка паузы. Мьютекс паузы удерживается только внутри блока —
        // во время блокирующего read() он свободен.
        {
            let (lock, cvar) = pause_state;

            let Ok(guard) = lock.lock() else { return };

            // Спим на condvar, пока стоит пауза и нет сигнала остановки.
            let Ok(_guard) = cvar.wait_while(guard, |paused| {
                *paused && !should_stop(active, destroyed)
            }) else {
                return;
            };
        }

        // Повторная проверка после паузы: флаги могли измениться,
        // пока поток спал на condvar (или пока он был заблокирован в read()).
        if should_stop(active, destroyed) {
            return;
        }

        // Чтение из FFmpeg. read() блокируется в syscall, пока FFmpeg не
        // запишет данные — поток не потребляет CPU в ожидании.
        let eof = match stdout.read(&mut read_buf) {
            Ok(0) => true,

            // Ошибка парсинга: уже накопленные валидные frames всё равно
            // передадим в буфер ниже, после чего reader завершится.
            Ok(n) => parser
                .parse_internal(&read_buf[..n], &mut frames)
                .is_err(),

            // EINTR — легитимная, не фатальная ситуация: сигналы в
            // многопоточном процессе могут прерывать syscall. Ретраим
            // чтение, а не завершаем поток из-за неё.
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,

            Err(_) => true,
        };

        // EOF: обязательный flush последнего не собранного пакета.
        //
        // Без этого шага последний Opus-фрейм трека теряется ВСЕГДА.
        // Хвост добавляется в тот же вектор ПОСЛЕ основных frames, поэтому
        // порядок пакетов сохраняется, а отправка в буфер идёт одним
        // проходом и под одним локом.
        if eof && parser.pending_len() != 0 {
            let mut tail = Vec::new();

            // Хвост используем только если «до-разбор» прошёл успешно.
            if parser.parse_internal(&[], &mut tail).is_ok() {
                frames.append(&mut tail);
            }
        }

        // Передача готовых пакетов в RingBuffer.
        if !frames.is_empty() {
            let (buffer_lock, buffer_cvar) = buffer_state;

            // ВАЖНО: объявлен до guard'а, чтобы notify происходил после unlock.
            let mut notifier = NotifyOnDrop {
                cvar: buffer_cvar,
                pending: false,
            };

            let Ok(mut buffer) = buffer_lock.lock() else { return };

            for (kind, packet) in frames.drain(..) {
                // Пропускаем служебные пакеты (Head, Tags, OggPage).
                if !kind.is_audio_frame() {
                    continue;
                }

                // Ждём свободное место. Проверка остановки стоит в начале
                // каждой итерации, поэтому покрывает и «до ожидания», и
                // «после пробуждения».
                loop {
                    if should_stop(active, destroyed) {
                        return;
                    }

                    if !buffer.is_full() {
                        break;
                    }

                    // Прежде чем уснуть на полном буфере, ОБЯЗАТЕЛЬНО будим
                    // consumer'а: он мог спать на этом же condvar в ожидании
                    // данных и не знать о пакетах, уже положенных в этой
                    // пачке. Иначе — взаимная блокировка (reader ждёт места,
                    // consumer ждёт данных).
                    notifier.flush();

                    buffer = match buffer_cvar.wait(buffer) {
                        Ok(b) => b,
                        Err(_) => return,
                    };
                }

                // Буфер отверг пакет — фатально. Флаг `active` сбросит
                // ReaderCleanup уже ПОСЛЕ reap'а процесса.
                if buffer.push(packet).is_err() {
                    return;
                }

                notifier.pending = true;
            }

            // Здесь: сначала дропается guard (unlock), затем notifier (notify_one).
        }

        // EOF обработан (включая хвост) — выходим из цикла чтения.
        //
        // Защита от переполнения внутреннего буфера парсера проверяется
        // ПОСЛЕ обработки уже готовых frames, чтобы не терять валидные
        // пакеты из-за последующего превышения лимита.
        if eof || parser.pending_len() > MAX_PARSER_PENDING {
            return;
        }
    }
}