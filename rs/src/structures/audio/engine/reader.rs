//! Тело фонового потока чтения stdout FFmpeg.
//!
//! Функция полностью самодостаточна: не хранит ссылок на `AudioEngine`,
//! получает только `Arc`-и на общие состояния. Это позволяет тестировать
//! её отдельно и упрощает вынос в отдельный модуль.

use super::constants::MAX_PARSER_PENDING;
use crate::structures::audio::{encoder::ogg::OggOpusDemuxer, ring_buffer::RingBuffer};
use std::{
    io::{BufReader, ErrorKind, Read},
    process::{Child, ChildStdout},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    }
};

/// Проверяет, нужно ли остановить reader.
#[inline(always)]
fn should_stop(active: &AtomicBool, destroyed: &AtomicBool) -> bool {
    !active.load(Ordering::Acquire) || destroyed.load(Ordering::Acquire)
}

/// Убивает и `wait()`-ит процесс FFmpeg, если он ещё не забран.
///
/// `std::process::Child` при `Drop` НЕ делает ни `kill`, ни `wait`, поэтому
/// без явного `wait()` завершившийся ffmpeg остаётся зомби. Вызывается в
/// конце `reader_loop` — до сброса `active`, чтобы повторный `start()`
/// (он проходит только после `active == false`) не мог столкнуться с
/// чужим reap'ом своего нового процесса.
///
/// `kill` на уже завершившемся процессе безвреден; `wait` после `kill`
/// не блокируется. Сам `wait` выполняется вне мьютекса.
fn reap_child(child: &Mutex<Option<Child>>) {
    let process = {
        let mut guard = child.lock().unwrap_or_else(|p| p.into_inner());
        guard.take()
    };

    if let Some(mut process) = process {
        let _ = process.kill();
        let _ = process.wait();
    }
}

/// RAII-уведомление consumer'а: если за текущую пачку в буфер попал хотя бы
/// один пакет, при выходе из блока (в том числе через ранний `break`) будет
/// выполнен `notify_one()` ровно один раз.
///
/// Без этого consumer, спящий на `buffer_cvar` в ожидании новых данных,
/// может не проснуться сразу после того, как reader успешно наполнил
/// буфер — либо ловится с задержкой на следующем чужом пробуждении, либо
/// требует поллинга с тайм-аутом на стороне consumer'а, что и есть лишняя
/// нагрузка, которую вы просили убрать.
struct NotifyOnDrop<'a> {
    cvar: &'a Condvar,
    should_notify: bool,
}

impl Drop for NotifyOnDrop<'_> {
    #[inline]
    fn drop(&mut self) {
        if self.should_notify {
            self.cvar.notify_one();
        }
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
/// * парсер переполнен.
///
/// # Аргументы
/// * `stdout` — piped stdout процесса FFmpeg.
/// * `active` — флаг активности reader'а.
/// * `destroyed` — флаг уничтожения движка.
/// * `pause_state` — состояние паузы (флаг + condvar).
/// * `buffer_state` — кольцевой буфер + condvar для ожидания места.
/// * `child` — процесс FFmpeg; reader убивает и reap-ит его при выходе.
pub(crate) fn reader_loop(
    stdout: ChildStdout,
    active: Arc<AtomicBool>,
    destroyed: Arc<AtomicBool>,
    pause_state: Arc<(Mutex<bool>, Condvar)>,
    buffer_state: Arc<(Mutex<RingBuffer>, Condvar)>,
    child: Arc<Mutex<Option<Child>>>,
) {
    // Буферизованное чтение stdout — сглаживает мелкие чтения от ОС.
    // read() блокируется в syscall, пока FFmpeg не запишет данные —
    // поток не потребляет CPU в ожидании, никакого спина/поллинга.
    let mut reader = BufReader::with_capacity(65536, stdout);

    // Демультиплексор Ogg/Opus, собирает аудио-пакеты из байтового потока.
    let mut parser = OggOpusDemuxer::new();

    // Буфер для одного чтения из stdout.
    let mut read_buf = [0u8; 16384];

    // Переиспользуемый вектор для парсинга (избегаем аллокаций в цикле).
    let mut frames = Vec::with_capacity(128);

    'reader: loop {
        // Проверка остановки: один из флагов мог быть сброшен извне.
        if should_stop(&active, &destroyed) {
            break;
        }

        // Обработка паузы.
        {
            let (lock, cvar) = &*pause_state;

            let mut paused = match lock.lock() {
                Ok(g) => g,
                Err(_) => break 'reader,
            };

            while *paused && !should_stop(&active, &destroyed) {
                paused = match cvar.wait(paused) {
                    Ok(g) => g,
                    Err(_) => break 'reader,
                };
            }
        }

        // Повторная проверка после паузы: флаги могли измениться,
        // пока поток спал на condvar.
        if should_stop(&active, &destroyed) {
            break;
        }

        // Чтение из FFmpeg.
        let eof = match reader.read(&mut read_buf) {
            Ok(0) => true,

            Ok(n) => {
                if parser.parse_internal(&read_buf[..n], &mut frames).is_err() {
                    // Уже накопленные валидные frames всё равно передадим
                    // в буфер ниже, после чего reader завершится.
                    true
                } else {
                    false
                }
            }

            // EINTR — легитимная, не фатальная ситуация: сигналы в
            // многопоточном процессе могут прерывать syscall. Ретраим
            // чтение, а не завершаем поток из-за неё.
            Err(e) if e.kind() == ErrorKind::Interrupted => continue 'reader,

            Err(_) => true,
        };

        // Передача готовых пакетов в RingBuffer.
        if !frames.is_empty() {
            let (buffer_lock, buffer_cvar) = &*buffer_state;

            let mut buffer = match buffer_lock.lock() {
                Ok(g) => g,
                Err(_) => break 'reader,
            };

            let mut notifier = NotifyOnDrop {
                cvar: buffer_cvar,
                should_notify: false,
            };

            for (kind, packet) in frames.drain(..) {
                // Пропускаем служебные пакеты (Head, Tags, OggPage).
                if !kind.is_audio_frame() {
                    continue;
                }

                // Ждём свободное место в буфере, если он заполнен.
                // Блокирующее ожидание на Condvar — никакого спина,
                // поток разбудится сигналом от consumer'а.
                while buffer.is_full() {
                    if should_stop(&active, &destroyed) {
                        break 'reader;
                    }

                    buffer = match buffer_cvar.wait(buffer) {
                        Ok(b) => b,
                        Err(_) => break 'reader,
                    };
                }

                if should_stop(&active, &destroyed) {
                    break 'reader;
                }

                match buffer.push(packet) {
                    Ok(()) => {
                        // Уведомляем consumer'а один раз после всей пачки —
                        // сделает Drop, даже если ниже случится break.
                        notifier.should_notify = true;
                    }
                    Err(_packet) => {
                        active.store(false, Ordering::Release);
                        break 'reader;
                    }
                }
            }

            drop(notifier);
        }

        // EOF: обязательный flush последнего не собранного пакета.
        //
        // Без этого шага последний Opus-фрейм трека теряется ВСЕГДА —
        // это систематическая, а не эпизодическая потеря хвоста.
        if eof {
            // На EOF парсер мог оставить незавершённые данные во внутреннем буфере.
            // Если они есть — пробуем «до-разобрать» их, передав пустой входной срез,
            // чтобы получить остаток уже готовых пакетов (tail).
            if parser.pending_len() != 0  {
                let mut tail = Vec::new();

                // Всё, что может, из накопленного. Проверяем, что вызов успешен и
                // что реально что-то получили.
                if parser.parse_internal(&[], &mut tail).is_ok() && !tail.is_empty() {
                    let (buffer_lock, buffer_cvar) = &*buffer_state;

                    // Если мьютекс отравлен — просто ничего не делаем и выходим из eof-ветки.
                    if let Ok(mut buffer) = buffer_lock.lock() {
                        // Флаг «кто-то положен в буфер» — чтобы разбудить потребителя
                        // ровно один раз в конце, а не дёргать notify на каждый пакет.
                        let mut notified = false;

                        // Метка tail нужна, чтобы из вложенного loop (ожидания места)
                        // можно было выйти сразу из всего цикла по tail при остановке.
                        'tail: for (kind, packet) in tail {
                            // Нас интересуют только аудио-фреймы; прочие типы пропускаем.
                            if !kind.is_audio_frame() {
                                continue;
                            }

                            // Ждём освобождения места в буфере. На EOF тоже ждём —
                            // иначе потеряем последние сэмплы. Но ждём с проверкой
                            // флагов остановки, чтобы не зависнуть навсегда, если
                            // потребитель больше не читает или поток останавливают.
                            loop {
                                // Если поток просят остановить/уничтожить — выходим
                                // из цикла целиком, не тратя время на оставшиеся пакеты.
                                if should_stop(&active, &destroyed) {
                                    break 'tail;
                                }

                                // Есть место — можно класть пакет.
                                if !buffer.is_full() {
                                    break;
                                }

                                // Буфер полон — засыпаем на condvar до сигнала от
                                // потребителя (pop/notify). Если мьютекс отравлен —
                                // выходим, продолжать бессмысленно.
                                buffer = match buffer_cvar.wait(buffer) {
                                    Ok(guard) => guard,
                                    Err(_) => break 'tail,
                                };
                            }

                            // Перепроверяем остановку после пробуждения: пока мы спали
                            // на condvar, флаги могли измениться.
                            if should_stop(&active, &destroyed) {
                                break;
                            }

                            // Пытаемся положить пакет. Если push не удался (например,
                            // гонка с закрытием), просто пропускаем его.
                            if buffer.push(packet).is_ok() {
                                notified = true;
                            }
                        }

                        // Будим потребителя, только если реально что-то положили —
                        // иначе получится лишний спурьёзный wakeup.
                        if notified {
                            buffer_cvar.notify_one();
                        }
                    }
                }
            }

            // EOF обработан — выходим из основного цикла чтения.
            break;
        }

        // Защита от переполнения внутреннего буфера парсера — проверяется
        // ПОСЛЕ обработки уже готовых frames, чтобы не терять валидные
        // пакеты из-за последующего превышения лимита.
        if parser.pending_len() > MAX_PARSER_PENDING {
            break;
        }
    }

    // Закрываем stdout ДО reap'а: ffmpeg, пишущий в полный pipe, получит
    // EPIPE и не будет зависать, даже если kill почему-то не сработал.
    drop(reader);

    // Естественное завершение (EOF, ошибка парсинга, переполнение) —
    // без этого ffmpeg остаётся зомби до явного destroy().
    reap_child(&child);

    // Поток завершается — сбрасываем флаг активности, чтобы внешний код
    // знал, что reader больше не работает. Это ПОСЛЕДНЕЕ действие потока.
    active.store(false, Ordering::Release);
}