use super::AudioEngine;
use {
    std::sync::atomic::Ordering,
    napi::bindgen_prelude::*,
    napi_derive::napi
};

#[napi]
impl AudioEngine {
    /// Проверяет, доступны ли данные для чтения.
    ///
    /// Возвращает `true`, если в буфере есть хотя бы один готовый пакет.
    /// Используется потребителем (JS) для проверки готовности перед
    /// извлечением пакетов через `get_packets`.
    ///
    /// # Возвращаемое значение
    /// `true`, если `get_size() > 0`; иначе `false`.
    #[napi(getter)]
    pub fn get_readable(&self) -> bool {
        // Готовность определяется наличием хотя бы одного пакета в буфере.
        self.get_size() > 0
    }

    // ============================================================
    // SIZE
    // ============================================================

    /// Возвращает текущее количество пакетов в буфере.
    ///
    /// Значение — мгновенный снимок: при конкурентной записи/чтении
    /// оно может устареть сразу после возврата.
    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer
            .0
            .lock()
            .map(|buffer| buffer.len().min(u32::MAX as usize) as u32)
            .unwrap_or(0)
    }

    // ============================================================
    // POSITION
    // ============================================================

    /// Возвращает текущую позицию чтения.
    ///
    /// Позиция увеличивается на фактическое количество извлечённых
    /// аудио-пакетов.
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position
            .load(Ordering::Acquire)
            .min(u32::MAX as usize) as u32
    }

    /// Устанавливает позицию чтения вручную.
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(
            pos as usize,
            Ordering::Release,
        );
    }

    // ============================================================
    // GET PACKETS
    // ============================================================

    /// Извлекает до `count` пакетов из буфера.
    ///
    /// Если `count == 0`, извлекается один пакет.
    ///
    /// Если доступно меньше пакетов, возвращается фактически доступное
    /// количество.
    ///
    /// После успешного извлечения reader уведомляется о появившемся
    /// свободном месте.
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        // Быстрый путь.
        if self.destroyed.load(Ordering::Acquire) {
            return Vec::new();
        }

        let count = (count as usize).max(1);

        let (buffer_lock, buffer_cvar) = &*self.buffer;

        let raw_packets = {
            let mut buffer = match buffer_lock.lock() {
                Ok(buffer) => buffer,
                Err(_) => return Vec::new(),
            };

            // Важно проверить destroyed ещё раз ПОСЛЕ получения mutex.
            //
            // Иначе возможна гонка:
            //
            // get_packets() -> destroyed == false
            // destroy()    -> destroyed = true
            // get_packets() -> получает mutex и читает уже уничтожаемый buffer
            //
            // Сам mutex не даст use-after-free, но семантически операция
            // уже не должна выполняться.
            if self.destroyed.load(Ordering::Acquire) {
                return Vec::new();
            }

            let available = buffer.len();

            if available == 0 {
                return Vec::new();
            }

            let limit = count.min(available);
            let mut extracted = Vec::with_capacity(limit);

            buffer.pop_many(&mut extracted, limit);

            if extracted.is_empty() { return Vec::new(); }

            // Позиция соответствует фактически извлечённым пакетам.
            //
            // Не используем обычный fetch_add: теоретическое переполнение
            // usize не должно превращать позицию обратно в маленькое число.
            let increment = extracted.len();

            let _ = self.position.try_update(
                Ordering::Release,
                Ordering::Relaxed,
                |current| current.checked_add(increment),
            );

            extracted
        };

        // Mutex уже освобождён.
        buffer_cvar.notify_one();

        raw_packets
            .into_iter()
            .map(Buffer::from)
            .collect()
    }

    // ============================================================
    // ADD PACKETS
    // ============================================================

    /// Добавляет пакеты в буфер из JavaScript.
    ///
    /// Добавление прекращается при заполнении буфера: остальные пакеты
    /// отбрасываются. Ошибка переполнения не превращается в panic.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Vec<u8>>) {
        // Быстрый путь.
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let mut buffer = match self.buffer.0.lock() {
            Ok(buffer) => buffer,
            Err(_) => return,
        };

        // Повторная проверка под mutex.
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        for packet in packets {
            if buffer.is_full() {
                break;
            }

            // Пустые пакеты `push` пропускает.
            buffer.push(&packet);
        }
    }

    // ============================================================
    // CAN ACCEPT
    // ============================================================

    /// Проверяет, есть ли в буфере место хотя бы под один пакет.
    #[napi]
    pub fn can_accept(&self) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let buffer = match self.buffer.0.lock() {
            Ok(buffer) => buffer,
            Err(_) => return false,
        };

        // Повторная проверка после захвата mutex.
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        !buffer.is_full()
    }

    // ============================================================
    // CAN ACCEPT THRESHOLD
    // ============================================================

    /// Проверяет, что заполненность буфера строго ниже указанного
    /// процента от `max_capacity`.
    ///
    /// `threshold_percent` автоматически ограничивается диапазоном
    /// `0..=100`.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let buffer = match self.buffer.0.lock() {
            Ok(buffer) => buffer,
            Err(_) => return false,
        };

        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let percent = threshold_percent.min(100) as usize;
        let capacity = self.max_capacity;

        if capacity == 0 {
            return false;
        }

        // Порог в слотах. `saturating_mul` защищает от переполнения на
        // 32-битных целях.
        let threshold = capacity.saturating_mul(percent) / 100;

        buffer.len() < threshold
    }
}