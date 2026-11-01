//! Тело фонового потока чтения stdout FFmpeg.
//!
//! Функция полностью самодостаточна: не хранит ссылок на `AudioEngine`,
//! получает только `Arc`-ссылки на общие состояния. Это позволяет тестировать
//! её отдельно и упрощает вынос в отдельный модуль.

use super::constants::{AUDIO_FRAMES_CAPACITY, AUDIO_READ_CHUNK, MAX_PARSER_PENDING};
use crate::structures::audio::{encoder::ogg::OggOpusDemuxer, ring::packet_queue::PacketQueue};
use std::{
    io::{ErrorKind, Read},
    process::{Child, ChildStdout},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
};

/// Проверяет, нужно ли остановить reader.
///
/// Оба флага читаются под Acquire: изменения состояния должны быть видны
/// до того, как по ним принимается решение.
#[inline]
fn should_stop(active: &AtomicBool, destroyed: &AtomicBool) -> bool {
    !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire)
}

/// Убивает процесс FFmpeg и дожидается его завершения, если он ещё не забран.
///
/// `std::process::Child` при `Drop` не делает ни `kill`, ни `wait`, поэтому
/// без явного `wait()` завершившийся FFmpeg остаётся зомби.
///
/// `kill` на уже завершившемся процессе безвреден, `wait` после `kill`
/// не блокируется. Сам `wait` выполняется вне мьютекса — не тормозим тех,
/// кому ещё нужен доступ к `child`.
fn reap_child(child: &Mutex<Option<Child>>) {
    let process = child.lock().unwrap_or_else(|p| p.into_inner()).take();

    if let Some(mut process) = process {
        let _ = process.kill();
        let _ = process.wait();
    }
}

/// RAII-финализатор потока: срабатывает при любом выходе из `reader_loop`,
/// включая панику (раскрутку стека).
///
/// Порядок действий важен:
/// 1. `reap_child` — FFmpeg не остаётся зомби;
/// 2. `active = false` — последнее действие. Повторный `start()` проходит
///    только после `active == false`, поэтому к этому моменту старый reader
///    уже не может снять чужой, новый процесс.
///
/// А stdout к этому моменту уже закрыт (его владелец — `read_and_demux`,
/// вернувшийся раньше), так что FFmpeg, пишущий в полный pipe, получит EPIPE
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

/// Читает stdout FFmpeg, разбирает Ogg/Opus на пакеты и складывает
/// аудио-пакеты в очередь `PacketQueue`.
///
/// Завершается, когда:
/// * `active` сброшен;
/// * `destroyed` выставлен;
/// * FFmpeg закрыл stdout (EOF): завершённые пакеты уже переданы в буфер,
///   оборванный хвост отбрасывается;
/// * произошла ошибка чтения (кроме `Interrupted`, который повторяется) или
///   ошибка разбора;
/// * парсер переполнен;
/// * очередь отвергла пакет или её мьютекс отравлен.
///
/// При выходе (в том числе при панике) процесс FFmpeg гарантированно
/// убивается и дожидается его завершения, после чего сбрасывается `active`.
///
/// # Аргументы
/// * `stdout` — piped stdout процесса FFmpeg.
/// * `active` — флаг активности reader'а.
/// * `destroyed` — флаг уничтожения движка.
/// * `pause_state` — состояние паузы (флаг + condvar).
/// * `buffer_state` — очередь пакетов + condvar для ожидания свободного места.
/// * `child` — процесс FFmpeg; reader убивает его и дожидается завершения
///   при выходе.
pub(crate) fn reader_loop(stdout: ChildStdout, active: Arc<AtomicBool>, destroyed: Arc<AtomicBool>, pause_state: Arc<(Mutex<bool>, Condvar)>, buffer_state: Arc<(Mutex<PacketQueue>, Condvar)>, child: Arc<Mutex<Option<Child>>>) {
    // Объявлен первым → освобождается последним: к моменту его срабатывания
    // `read_and_demux` уже вернулся, а значит stdout закрыт, а парсер и
    // буферы освобождены. Так FFmpeg получает EPIPE раньше, чем мы его
    // убиваем, и не зависает на полном pipe.
    let _cleanup = ReaderCleanup {
        child: &*child,
        active: &*active,
    };

    read_and_demux(stdout, &active, &destroyed, &pause_state, &buffer_state);
}

/// Основной цикл. Владеет stdout, парсером и временными буферами; при любом
/// выходе (`return` или паника) всё это освобождается до срабатывания
/// `ReaderCleanup`.
fn read_and_demux(mut stdout: ChildStdout, active: &AtomicBool, destroyed: &AtomicBool, pause_state: &(Mutex<bool>, Condvar), buffer_state: &(Mutex<PacketQueue>, Condvar)) {
    // Разборщик Ogg/Opus, собирает аудио-пакеты из байтового потока.
    let mut parser = OggOpusDemuxer::new();

    // Буфер для одного чтения из stdout (на куче — не зависим от размера
    // стека потока).
    let mut read_buf = vec![0u8; AUDIO_READ_CHUNK];

    // Повторно используемый вектор для разбора (избегаем выделений памяти
    // в цикле).
    let mut frames = Vec::with_capacity(AUDIO_FRAMES_CAPACITY);

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
            // Проверка `should_stop` внутри предиката — чтобы снятие active
            // или destroy тоже разбудило поток (иначе повиснем до внешнего
            // notify от того, кто ставил паузу).
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

            // Ошибка разбора: уже накопленные валидные frames всё равно
            // передадим в буфер ниже, после чего reader завершится.
            Ok(n) => parser
                .parse_internal(&read_buf[..n], &mut frames)
                .is_err(),

            // EINTR — допустимая, не фатальная ситуация: сигналы в
            // многопоточном процессе могут прерывать системный вызов.
            // Повторяем чтение, а не завершаем поток из-за неё.
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,

            Err(_) => true,
        };

        // EOF: завершённые пакеты уже выданы `parse_internal` на своих страницах
        // (пакет Ogg заканчивается lacing-байтом < 255, и он эмитится сразу).
        // Усечённый хвост (поток оборвался на сегменте 255) выдавать нельзя:
        // декодер получил бы битый кадр, поэтому он отбрасывается вместе с
        // парсером при завершении потока.

        // Передача готовых пакетов в очередь.
        if !frames.is_empty() {
            let (buffer_lock, buffer_cvar) = buffer_state;

            let Ok(mut buffer) = buffer_lock.lock() else { return };

            for (kind, packet) in frames.drain(..) {
                // Пропускаем служебные пакеты (Head, Tags, OggPage).
                // Это не аудиоданные, и они не должны доходить
                // до кодера или отправителя.
                if !kind.is_audio_frame() {
                    continue;
                }

                // Ждём свободное место. Проверка остановки стоит в начале
                // каждой итерации, поэтому покрывает и случай «до ожидания»,
                // и случай «после пробуждения».
                loop {
                    if should_stop(active, destroyed) {
                        return;
                    }

                    if !buffer.is_full() {
                        break;
                    }

                    // Ждём, пока consumer (`get_packets`) освободит место.
                    buffer = match buffer_cvar.wait(buffer) {
                        Ok(b) => b,
                        Err(_) => return,
                    };
                }

                // Место проверено выше, producer здесь один: `push` отклонил
                // бы только пустой пакет, а парсер пустых не выдаёт.
                buffer.push(&packet);
            }
        }

        // EOF обработан (включая хвост) — выходим из цикла чтения.
        //
        // Защита от переполнения внутреннего буфера парсера проверяется
        // после обработки уже готовых frames, чтобы не терять валидные
        // пакеты из-за последующего превышения лимита.
        if eof || parser.pending_len() > MAX_PARSER_PENDING {
            return;
        }
    }
}