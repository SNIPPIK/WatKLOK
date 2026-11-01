//! Очередь Opus-пакетов для `AudioEngine` с непрерывным хранением данных.
//!
//! # Зачем не `Vec<Vec<u8>>`
//!
//! Движок кладёт в очередь весь трек сразу (FFmpeg декодирует на порядок
//! быстрее реального времени): ~10 000 пакетов по несколько сотен байт.
//! Если хранить каждый пакет отдельной аллокацией, то на трек приходится
//! ~10 000 `malloc` в потоке reader'а и столько же `free` в другом потоке по
//! мере воспроизведения. Такая картина (много мелких блоков, живущих разное
//! время, в разных аренах) приводит к фрагментации: память освобождена, но
//! процесс не возвращает её ОС, и RSS растёт от трека к треку.
//!
//! Здесь байты всех пакетов лежат в одном непрерывном буфере, а длины — в
//! другом. На трек приходится две растущие аллокации, которые освобождаются
//! целиком при уничтожении движка.
//!
//! Доступ синхронизируется снаружи (`Mutex<PacketQueue>` в `AudioEngine`).

use std::collections::VecDeque;

/// Если очередь опустела и хранилище байт больше этого размера, память
/// возвращается аллокатору (конец трека), а не держится до `destroy`.
const RELEASE_THRESHOLD_BYTES: usize = 1024 * 1024;

/// FIFO-очередь пакетов с ограничением по их количеству.
pub struct PacketQueue {
    /// Байты всех пакетов подряд.
    data: VecDeque<u8>,

    /// Длина каждого пакета в порядке очереди. Инвариант:
    /// `lens.iter().sum() == data.len()`.
    lens: VecDeque<u32>,

    /// Максимальное число пакетов в очереди.
    capacity: usize,
}

impl PacketQueue {
    /// Создаёт пустую очередь. Память не выделяется до первого `push`.
    ///
    /// # Panics
    /// Паникует, если `capacity == 0`.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "PacketQueue capacity must be greater than zero");

        Self {
            data: VecDeque::new(),
            lens: VecDeque::new(),
            capacity,
        }
    }

    /// Количество пакетов в очереди.
    #[inline]
    #[must_use]
    pub fn len(&self) -> usize {
        self.lens.len()
    }

    /// `true`, если очередь пуста.
    #[inline]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.lens.is_empty()
    }

    /// `true`, если достигнут предел по числу пакетов.
    #[inline]
    #[must_use]
    pub fn is_full(&self) -> bool {
        self.lens.len() >= self.capacity
    }

    /// Добавляет пакет (копирует байты). `false`, если пакет не принят:
    /// он пуст, слишком велик или очередь заполнена.
    pub fn push(&mut self, packet: &[u8]) -> bool {
        if packet.is_empty() || self.is_full() {
            return false;
        }

        let Ok(len) = u32::try_from(packet.len()) else {
            return false;
        };

        self.data.extend(packet.iter());
        self.lens.push_back(len);
        true
    }

    /// Извлекает до `limit` пакетов в `out` (в порядке очереди).
    pub fn pop_many(&mut self, out: &mut Vec<Vec<u8>>, limit: usize) {
        let count = limit.min(self.lens.len());
        out.reserve(count);

        for _ in 0..count {
            let Some(len) = self.lens.pop_front() else {
                break;
            };
            let len = len as usize;

            // Данные могут лежать в двух частях (VecDeque «завернулся»).
            let mut packet = Vec::with_capacity(len);
            let (front, back) = self.data.as_slices();

            if len <= front.len() {
                packet.extend_from_slice(&front[..len]);
            } else {
                packet.extend_from_slice(front);
                packet.extend_from_slice(&back[..len - front.len()]);
            }

            drop(self.data.drain(..len));
            out.push(packet);
        }

        // Трек доигран: вернуть память, не дожидаясь `destroy`.
        if self.lens.is_empty() && self.data.capacity() > RELEASE_THRESHOLD_BYTES {
            self.data = VecDeque::new();
            self.lens = VecDeque::new();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkt(n: u8, len: usize) -> Vec<u8> {
        vec![n; len]
    }

    fn pop_all(queue: &mut PacketQueue) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        queue.pop_many(&mut out, usize::MAX);
        out
    }

    #[test]
    fn fifo_order_and_exact_contents() {
        let mut queue = PacketQueue::new(8);
        assert!(queue.is_empty());

        assert!(queue.push(&pkt(1, 3)));
        assert!(queue.push(&pkt(2, 5)));
        assert!(queue.push(&pkt(3, 1)));
        assert_eq!(queue.len(), 3);

        assert_eq!(pop_all(&mut queue), vec![pkt(1, 3), pkt(2, 5), pkt(3, 1)]);
        assert!(queue.is_empty());
    }

    #[test]
    fn rejects_empty_packet() {
        let mut queue = PacketQueue::new(4);
        assert!(!queue.push(&[]));
        assert!(queue.is_empty());
    }

    #[test]
    fn rejects_when_full_and_accepts_after_pop() {
        let mut queue = PacketQueue::new(2);
        assert!(queue.push(&pkt(1, 4)));
        assert!(queue.push(&pkt(2, 4)));
        assert!(queue.is_full());
        assert!(!queue.push(&pkt(3, 4)));

        let mut out = Vec::new();
        queue.pop_many(&mut out, 1);
        assert_eq!(out, vec![pkt(1, 4)]);
        assert!(!queue.is_full());
        assert!(queue.push(&pkt(3, 4)));
    }

    #[test]
    fn pop_many_respects_limit() {
        let mut queue = PacketQueue::new(8);
        for n in 0..5u8 {
            assert!(queue.push(&pkt(n, 4)));
        }

        let mut out = Vec::new();
        queue.pop_many(&mut out, 3);
        assert_eq!(out.len(), 3);
        assert_eq!(queue.len(), 2);

        out.clear();
        queue.pop_many(&mut out, 10);
        assert_eq!(out.len(), 2);
        assert!(queue.is_empty());
    }

    /// Чередование записи и чтения заставляет `VecDeque` «заворачиваться»:
    /// пакет при этом может лежать в двух частях.
    #[test]
    fn packets_survive_vecdeque_wraparound() {
        // В очереди остаётся ~1/3 записанных пакетов (167 из 500), поэтому
        // предел должен быть заведомо выше.
        let mut queue = PacketQueue::new(256);
        let mut expected = std::collections::VecDeque::new();
        let mut out = Vec::new();

        for round in 0..500usize {
            let packet = pkt((round % 251) as u8, 1 + round % 37);
            assert!(queue.push(&packet));
            expected.push_back(packet);

            if round % 3 != 0 {
                out.clear();
                queue.pop_many(&mut out, 1);
                assert_eq!(out.len(), 1);
                assert_eq!(Some(out.remove(0)), expected.pop_front());
            }
        }

        let rest = pop_all(&mut queue);
        assert_eq!(rest, expected.into_iter().collect::<Vec<_>>());
    }

    #[test]
    fn memory_is_released_when_drained() {
        let mut queue = PacketQueue::new(100_000);
        let packet = pkt(7, 400);

        // ~2 МБ: больше порога возврата памяти.
        for _ in 0..5_000 {
            assert!(queue.push(&packet));
        }
        assert!(queue.data.capacity() > RELEASE_THRESHOLD_BYTES);

        assert_eq!(pop_all(&mut queue).len(), 5_000);
        assert!(queue.data.capacity() < RELEASE_THRESHOLD_BYTES);
    }

    #[test]
    fn invariant_total_len_matches_data() {
        let mut queue = PacketQueue::new(16);
        for n in 1..=10usize {
            assert!(queue.push(&pkt(n as u8, n)));
        }

        let mut out = Vec::new();
        queue.pop_many(&mut out, 4);

        let total: usize = queue.lens.iter().map(|&l| l as usize).sum();
        assert_eq!(total, queue.data.len());
    }
}
