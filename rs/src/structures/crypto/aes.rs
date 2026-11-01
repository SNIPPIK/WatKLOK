use crate::utils::duration::FRAME_DURATION_MS;
use {
    parking_lot::RwLock,
    std::{
        sync::atomic::{compiler_fence, AtomicU16, AtomicU32, Ordering},
        fmt
    },
    aes_gcm::{
        aead::{KeyInit, AeadInOut, inout::InOutBuf},
        Aes256Gcm, Nonce
    },
    rand::{
        RngExt,
        rng
    }
};

/// Размер RTP-заголовка без расширений (байт).
///
/// Базовая часть: version/P/X/CC (1 байт) + M/PT (1 байт) +
/// sequence (2 байта) + timestamp (4 байта) + SSRC (4 байта) = 12.
const RTP_HEADER_SIZE: usize = 12;

/// Размер тега аутентификации AES-GCM (байт).
///
/// Добавляется к каждому зашифрованному пакету и проверяется при расшифровке.
const GCM_TAG_SIZE: usize = 16;

/// Допустимая длина ключа AES-256 (байт).
///
/// Для режима AES-256-GCM требуется ровно 32 байта.
const KEY_SIZE: usize = 32;

/// Смещение поля sequence в RTP-заголовке.
const RTP_SEQUENCE_OFFSET: usize = 2;

/// Смещение поля timestamp в RTP-заголовке.
const RTP_TIMESTAMP_OFFSET: usize = 4;

/// Смещение поля SSRC в RTP-заголовке.
const RTP_SSRC_OFFSET: usize = 8;

/// Полный размер nonce для AES-GCM (байт).
///
/// AES-GCM всегда использует 12-байтовый nonce.
const NONCE_SIZE: usize = 12;

/// Размер значащей части nonce (байт).
///
/// В Discord используется счётчик в первых 4 байтах nonce,
/// остальные 8 байт остаются нулями.
const NONCE_COUNTER_SIZE: usize = 4;

/// Значение первого байта RTP-заголовка: Version = 2.
///
/// `0x80` = `10` в старших двух битах (версия 2) + нулевые P/X/CC.
const RTP_VERSION: u8 = 0x80;

/// Payload Type для Opus в RTP.
///
/// Значение 120 — динамический тип нагрузки, используемый Discord Voice.
const RTP_PAYLOAD_TYPE_OPUS: u8 = 120;

/// Приращение временной метки RTP для одного пакета.
///
/// Opus 48 кГц, кадр `FRAME_DURATION_MS` (20 мс) = 960 отсчётов.
const TIMESTAMP_INC: u32 = 48000 * (FRAME_DURATION_MS as u32) / 1000;

// ============================================================================
// Зануление ключевого материала
// ============================================================================

/// Гарантированно записывает нули в `bytes`.
///
/// Обычный цикл `*b = 0` компилятор вправе выбросить как «мёртвую запись»,
/// если буфер дальше не читается — а ради этого буфер и зануляется.
/// `write_volatile` такую оптимизацию запрещает, `compiler_fence` не даёт
/// переставить запись за пределы функции.
fn wipe(bytes: &mut [u8]) {
    for byte in bytes.iter_mut() {
        // SAFETY: `byte` — валидная уникальная ссылка на инициализированный u8.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

/// Владеет копией ключа и зануляет её при любом выходе из функции
/// (в том числе через `?` и раннюю ошибку).
struct WipeOnDrop(Vec<u8>);

impl Drop for WipeOnDrop {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

// ============================================================================
// Ошибки криптографических операций
// ============================================================================

/// Типы ошибок, специфичные для криптографических операций.
#[derive(Debug)]
pub enum CryptoError {
    /// Ключ шифрования имеет неверную длину (должен быть 32 байта для AES-256).
    InvalidKeyLength(usize),

    /// Ошибка при шифровании (проблема с nonce, AAD или внутренняя ошибка AES-GCM).
    EncryptionFailed(String),

    /// Сокет ещё не создан - (ssrc/key не заданы).
    NotInitialized
}

/// Реализация `Display` для преобразования ошибки в строку.
impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidKeyLength(len) => write!(f, "Invalid key length: {}", len),
            CryptoError::EncryptionFailed(msg) => write!(f, "Encryption failed: {}", msg),
            CryptoError::NotInitialized => write!(f, "VoiceRTPSocket is not initialized")
        }
    }
}

/// Реализация `Error` для совместимости со стандартным трейтом.
impl std::error::Error for CryptoError {}
// ============================================================================
// Внутренние параметры шифрования
// ============================================================================

/// Внутреннее состояние шифра: появляется после `initialize`.
struct EncryptorState {
    /// 32-битный идентификатор источника синхронизации.
    ssrc: u32,

    /// Экземпляр шифра AES-256-GCM.
    cipher: Aes256Gcm
}

// ============================================================================
// VoiceRTPSocket
// ============================================================================

/// Объект RTP-сокета для голоса.
/// Выполняет шифрование аудио фреймов (Opus) в соответствии с требованиями Discord.
///
/// Создаётся пустым через [`new`], `ssrc` и ключ задается позже через [`initialize`].
/// Это позволяет поднять сокет до получения голосового ключа от Discord
///
/// # Атомарные счётчики
/// - `sequence` – 16-битный счётчик RTP-пакетов (оборачивается).
/// - `timestamp` – 32-битная метка времени, увеличивается на `TIMESTAMP_INC` для каждого пакета.
/// - `counter` – 32-битный счётчик nonce (используется как первые 4 байта 12-байтового nonce).
///
/// # Безопасность nonce
///
/// Для AES-GCM повтор пары (ключ, nonce) полностью ломает и
/// конфиденциальность, и аутентификацию. Поэтому `counter` стартует
/// случайно только в [`new`] и дальше **только растёт**: ни `initialize`,
/// ни `destroy` его не трогают. Так повторная инициализация не может
/// породить коллизию ни при новом ключе (nonce тогда не важен), ни при
/// том же самом (например, resume или `destroy` + `initialize` с прежним
/// ключом) — счётчик просто продолжает счёт. Раньше `initialize`
/// перебрасывал счётчик случайно, а `destroy` обнулял его: при повторе
/// ключа это давало коллизии «на днях рождения» (десятки тысяч пакетов)
/// или гарантированный повтор после `destroy`. Бонус — безопасность
/// больше не зависит от предположения «Discord выдаёт новый ключ на
/// каждый `initialize`».
///
/// 32 бита хватает на ~2,7 года непрерывной отправки по 50 пакетов/с на
/// одном ключе; ключ живёт в пределах голосовой сессии.
///
/// # Потокобезопасность
/// Все публичные методы принимают `&self`. Состояние шифра защищено `RwLock`
/// (`parking_lot`: без отравления, поэтому паника в одном потоке не
/// превращается в вечные `expect`-паники горячего пути у остальных).
/// `initialize` и `destroy` берут write-lock и держат его на всё время
/// изменения счётчиков — это важно: если сброс/установка счётчиков
/// происходит не под тем же write-lock, что и запись `state`, конкурентные
/// вызовы `initialize`/`destroy` могут переплестись и оставить свежий
/// шифр с чужими счётчиками. `packet_into` и `is_initialized` берут read-lock.
///
/// `packet_into` читает и продвигает `sequence`/`timestamp` двумя отдельными
/// шагами, поэтому вызывающий обязан сериализовать его для одного сокета.
/// В планировщике это обеспечивает мьютекс `Prepared` в `SocketInner`.
pub struct VoiceRTPSocket {
    /// Состояние шифра; `None`, пока не вызван `initialize`.
    state: RwLock<Option<EncryptorState>>,

    /// Порядковый номер RTP-пакета (16 бит, оборачивается).
    ///
    /// Продвигается на каждый собранный RTP-пакет (`packet_into`).
    /// При молчании и keepalive не двигается.
    sequence: AtomicU16,

    /// Временная метка RTP (32 бита).
    ///
    /// Продвигается на `TIMESTAMP_INC` (960 сэмплов = 20 мс) за каждый
    /// Opus-фрейм. При молчании продолжает расти (см. `advance_timestamp`),
    /// чтобы timeline на стороне получателя не «застыла»
    timestamp: AtomicU32,

    /// Счётчик nonce (32 бита, инкрементируется после каждого использования).
    counter: AtomicU32
}

impl VoiceRTPSocket {
    /// Создаёт неинициализированный RTP-сокет.
    ///
    /// SSRC и ключ шифрования задаются отдельно через [`initialize`].
    /// Начальные значения sequence, timestamp и nonce counter
    /// рандомизируются для избежания предсказуемого старта сессии.
    ///
    /// # Возвращаемое значение
    /// Новый `VoiceRTPSocket` в состоянии «не инициализирован».
    pub fn new() -> Self {
        // Генератор случайных чисел для начальных значений счётчиков.
        let mut rng = rng();

        Self {
            // Состояние шифрования отсутствует до вызова initialize().
            state: RwLock::new(None),

            // Случайное начальное значение RTP sequence (16 бит).
            sequence: AtomicU16::new(rng.random()),

            // Случайное начальное значение RTP timestamp (32 бита).
            timestamp: AtomicU32::new(rng.random()),

            // Случайное начальное значение nonce counter (32 бита).
            counter: AtomicU32::new(rng.random())
        }
    }

    /// Продвигает sequence (+1) и timestamp (+`TIMESTAMP_INC`) на один
    /// Opus-фрейм.
    ///
    /// Вызывается ровно один раз на каждый собранный RTP-пакет. В штатном
    /// режиме (один пакет за тик) это `+1 / +960` на 20 мс. Если несколько
    /// пакетов уходят за один тик (догоняющая отправка), каждый получает
    /// свою позицию в timeline: seq N, N+1 и ts T, T+960.
    #[inline]
    fn advance_counters(&self) {
        self.sequence.fetch_add(1, Ordering::Relaxed);
        self.timestamp.fetch_add(TIMESTAMP_INC, Ordering::Relaxed);
    }

    /// Продвигает timestamp на `frames` кадров (по 20 мс), не трогая sequence.
    ///
    /// Планировщик не тикает для простаивающих сессий, поэтому провал в потоке
    /// (пауза, молчание) компенсируется одним шагом при возобновлении отправки.
    /// Умножение по модулю 2^32, как и сам timestamp: переполнение — норма RTP.
    #[inline]
    pub(crate) fn advance_timestamp(&self, frames: u64) {
        let delta = (frames as u32).wrapping_mul(TIMESTAMP_INC);
        self.timestamp.fetch_add(delta, Ordering::Relaxed);
    }

    /// Инициализирует RTP-сокет.
    ///
    /// # Аргументы
    /// * `ssrc` — 32-битный идентификатор источника синхронизации.
    /// * `key` — 32-байтный ключ AES-256-GCM.
    ///
    /// При каждой инициализации `sequence` и `timestamp` получают новые
    /// случайные значения (новая RTP-«временная линия»). Счётчик nonce
    /// НЕ сбрасывается — он только растёт (см. «Безопасность nonce»).
    ///
    /// Копия ключа, переданная по значению, зануляется на любом пути
    /// выхода, включая ошибку длины.
    ///
    /// # Возвращаемое значение
    /// `Ok(())` при успешной инициализации.
    ///
    /// # Ошибки
    /// * `InvalidKeyLength` — ключ имеет неверную длину.
    /// * `EncryptionFailed` — не удалось создать AES-GCM cipher.
    pub fn initialize(&self, ssrc: u32, key: Vec<u8>) -> Result<(), CryptoError> {
        // С этого момента ключ принадлежит охраннику и будет занулён при
        // выходе из функции — в том числе на ранних `return`/`?` ниже.
        let key = WipeOnDrop(key);

        // Проверяем длину ключа — AES-256 требует ровно 32 байта.
        if key.0.len() != KEY_SIZE {
            return Err(CryptoError::InvalidKeyLength(key.0.len()));
        }

        // Создаём шифр AES-256-GCM прямо из переданного ключа: лишняя копия
        // в стековом массиве не нужна (и её пришлось бы тоже занулять).
        // Раундовые ключи внутри `Aes256Gcm` зануляются при его Drop
        // (включена feature `zeroize`).
        let cipher = Aes256Gcm::new_from_slice(&key.0)
            .map_err(|_| {
                CryptoError::EncryptionFailed("invalid AES-256 key".into())
            })?;

        // Готовим генератор случайных чисел для новой RTP-линии.
        let mut rng = rng();

        // Держим write-lock на всё время: сброс счётчиков и публикация
        // нового состояния должны быть атомарны относительно destroy().
        let mut guard = self.state.write();

        // Счётчики не участвуют в синхронизации памяти между потоками
        // помимо того, что уже обеспечивает write-lock; достаточно Relaxed.
        // `counter` намеренно не трогаем.
        self.sequence.store(rng.random(), Ordering::Relaxed);
        self.timestamp.store(rng.random(), Ordering::Relaxed);

        // Публикуем новое состояние, не отпуская write-lock — это и даёт
        // атомарность относительно destroy().
        *guard = Some(EncryptorState { ssrc, cipher });

        Ok(())
    }

    /// Проверяет, инициализирован ли RTP-сокет.
    ///
    /// # Возвращаемое значение
    /// `true`, если `initialize` уже был вызван и состояние шифра присутствует.
    #[inline]
    pub fn is_initialized(&self) -> bool {
        self.state.read().is_some()
    }

    /// Генерирует 12-байтовый nonce для AES-GCM.
    ///
    /// Используется 32-битный счётчик в big-endian формате,
    /// остальные байты nonce заполняются нулями.
    ///
    /// # Возвращаемое значение
    /// Массив из `NONCE_SIZE` байт.
    #[inline]
    fn generate_nonce(&self) -> [u8; NONCE_SIZE] {
        // Relaxed достаточно: счётчик нужен только для получения
        // уникального значения nonce, а не для публикации памяти.
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);

        // Готовим массив из 12 байт, заполненный нулями.
        let mut nonce = [0u8; NONCE_SIZE];

        // Копируем первые 4 байта счётчика в big-endian.
        nonce[..NONCE_COUNTER_SIZE]
            .copy_from_slice(&counter.to_be_bytes());

        nonce
    }

    /// Формирует и шифрует RTP-пакет в переданный буфер (без аллокации, если
    /// ёмкости `out` хватает). Буфер перед записью очищается.
    ///
    /// Нужен горячему пути планировщика: аллокация на каждом тике берёт общий
    /// лок аллокатора и может ждать другие потоки (например, `malloc_trim`).
    ///
    /// # Ошибки
    /// * `NotInitialized` — сокет не инициализирован.
    /// * `EncryptionFailed` — ошибка AES-GCM.
    pub fn packet_into(&self, frame: &[u8], out: &mut Vec<u8>) -> Result<(), CryptoError> {
        // Держим read-lock на всё время шифрования.
        let guard = self.state.read();

        // Если состояние отсутствует — сокет не инициализирован.
        let state = guard
            .as_ref()
            .ok_or(CryptoError::NotInitialized)?;

        // ✅ Заголовок собирается read-only, состояние не мутируется.
        let header = self.build_header(state.ssrc);

        // Генерируем nonce (инкрементирует counter).
        let nonce_bytes = self.generate_nonce();
        let nonce = Nonce::from(nonce_bytes);

        // Память под весь пакет резервируем заранее.
        out.clear();
        out.reserve(
            RTP_HEADER_SIZE
                + frame.len()
                + GCM_TAG_SIZE
                + NONCE_COUNTER_SIZE
        );

        // RTP header остаётся открытым и используется как AAD.
        out.extend_from_slice(&header);

        // Добавляем исходный Opus payload.
        out.extend_from_slice(frame);

        // Шифруем payload непосредственно внутри итогового буфера.
        let payload = &mut out[RTP_HEADER_SIZE..];

        let tag = match state
            .cipher
            .encrypt_inout_detached(&nonce, &header, InOutBuf::from(payload))
        {
            Ok(tag) => tag,
            Err(error) => {
                // В `out` лежит заголовок и открытый Opus-кадр: не оставляем
                // его в переиспользуемом буфере.
                out.clear();
                return Err(CryptoError::EncryptionFailed(error.to_string()));
            }
        };

        // GCM authentication tag.
        out.extend_from_slice(tag.as_slice());
        out.extend_from_slice(&nonce_bytes[..NONCE_COUNTER_SIZE]);

        // Пакет успешно собран — продвигаем RTP-счётчики.
        self.advance_counters();
        Ok(())
    }

    /// Собирает 12-байтовый RTP-заголовок из ТЕКУЩИХ значений sequence/timestamp.
    ///
    /// Не мутирует состояние. Продвижение счётчиков выполняют
    /// [`advance_counters`] (обычный пакет) и [`advance_timestamp`]
    /// (холостой тик) — вызывающие обязаны дёрнуть один из них.
    #[inline]
    fn build_header(&self, ssrc: u32) -> [u8; RTP_HEADER_SIZE] {
        // Инициализируем заголовок нулями.
        let mut header = [0u8; RTP_HEADER_SIZE];

        // Байт 0: Version = 2.
        header[0] = RTP_VERSION;
        // Байт 1: Payload Type = 120 (Opus).
        header[1] = RTP_PAYLOAD_TYPE_OPUS;

        // Читаем текущие значения. Никаких fetch_add — продвижение снаружи.
        let sequence = self.sequence.load(Ordering::Relaxed);
        let timestamp = self.timestamp.load(Ordering::Relaxed);

        // Записываем sequence в big-endian (2 байта).
        header[RTP_SEQUENCE_OFFSET..RTP_TIMESTAMP_OFFSET].copy_from_slice(&sequence.to_be_bytes());

        // Записываем timestamp в big-endian (4 байта).
        header[RTP_TIMESTAMP_OFFSET..RTP_SSRC_OFFSET].copy_from_slice(&timestamp.to_be_bytes());

        // Записываем SSRC (4 байта).
        header[RTP_SSRC_OFFSET..RTP_HEADER_SIZE].copy_from_slice(&ssrc.to_be_bytes());

        header
    }

    /// Сбрасывает состояние шифрования: шифр (и его ключевой материал,
    /// зануляется при Drop) удаляется, RTP-счётчики обнуляются.
    ///
    /// `counter` nonce НЕ обнуляется: после `destroy` + `initialize` с тем
    /// же ключом сброс в 0 повторил бы уже использованные nonce.
    /// После вызова требуется повторный [`initialize`].
    /// Повторный вызов безопасен.
    #[inline]
    pub fn destroy(&self) {
        let mut guard = self.state.write();
        *guard = None;

        self.sequence.store(0, Ordering::Relaxed);
        self.timestamp.store(0, Ordering::Relaxed);
    }
}

/// `VoiceRTPSocket` можно создавать без аргументов.
impl Default for VoiceRTPSocket {
    fn default() -> Self {
        Self::new()
    }
}

/// Деструктор: удаляет шифр (его ключевой материал зануляется при Drop).
impl Drop for VoiceRTPSocket {
    fn drop(&mut self) {
        // `&mut self`: других владельцев нет, берём состояние без блокировки.
        // Drop шифра зануляет раундовые ключи.
        *self.state.get_mut() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; KEY_SIZE] = [0x42; KEY_SIZE];
    const SSRC: u32 = 0x0102_0304;

    fn ready_socket() -> VoiceRTPSocket {
        let socket = VoiceRTPSocket::new();
        socket.initialize(SSRC, KEY.to_vec()).unwrap();
        socket
    }

    /// Неверная длина ключа — ошибка, состояние не инициализируется.
    #[test]
    fn rejects_wrong_key_length() {
        let socket = VoiceRTPSocket::new();
        assert!(matches!(
            socket.initialize(SSRC, vec![0; 16]),
            Err(CryptoError::InvalidKeyLength(16))
        ));
        assert!(!socket.is_initialized());
    }

    /// До `initialize` пакет собрать нельзя.
    #[test]
    fn packet_requires_initialization() {
        let socket = VoiceRTPSocket::new();
        let mut out = Vec::new();
        assert!(matches!(
            socket.packet_into(b"opus", &mut out),
            Err(CryptoError::NotInitialized)
        ));
    }

    /// Формат пакета: заголовок | шифртекст | тег(16) | nonce(4); шифртекст
    /// совпадает с эталонным шифрованием тем же шифром, заголовок — AAD.
    #[test]
    fn packet_layout_matches_reference_encryption() {
        let socket = ready_socket();
        socket.sequence.store(0xFFFE, Ordering::Relaxed);
        socket.timestamp.store(1_000, Ordering::Relaxed);
        socket.counter.store(7, Ordering::Relaxed);

        let frame = b"opus-frame-payload";
        let mut out = Vec::new();
        socket.packet_into(frame, &mut out).unwrap();

        assert_eq!(out.len(), RTP_HEADER_SIZE + frame.len() + GCM_TAG_SIZE + NONCE_COUNTER_SIZE);

        // Заголовок.
        let header = &out[..RTP_HEADER_SIZE];
        assert_eq!(header[0], RTP_VERSION);
        assert_eq!(header[1], RTP_PAYLOAD_TYPE_OPUS);
        assert_eq!(&header[2..4], &0xFFFEu16.to_be_bytes());
        assert_eq!(&header[4..8], &1_000u32.to_be_bytes());
        assert_eq!(&header[8..12], &SSRC.to_be_bytes());

        // Nonce в хвосте — тот же счётчик, что использован при шифровании.
        let nonce_tail = &out[out.len() - NONCE_COUNTER_SIZE..];
        assert_eq!(nonce_tail, &7u32.to_be_bytes());

        // Эталон: то же шифрование «снаружи».
        let cipher = Aes256Gcm::new_from_slice(&KEY).unwrap();
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        nonce_bytes[..NONCE_COUNTER_SIZE].copy_from_slice(&7u32.to_be_bytes());
        let nonce = Nonce::from(nonce_bytes);
        let mut expected = frame.to_vec();
        let tag = cipher
            .encrypt_inout_detached(&nonce, header, InOutBuf::from(expected.as_mut_slice()))
            .unwrap();

        let body = &out[RTP_HEADER_SIZE..RTP_HEADER_SIZE + frame.len()];
        assert_eq!(body, expected.as_slice(), "шифртекст");
        assert_ne!(body, frame.as_slice(), "payload не должен лежать открытым");
        let tag_in_packet = &out[RTP_HEADER_SIZE + frame.len()..out.len() - NONCE_COUNTER_SIZE];
        assert_eq!(tag_in_packet, tag.as_slice(), "тег");
    }

    /// Каждый пакет: sequence +1, timestamp +960, nonce +1; sequence
    /// оборачивается через 0xFFFF.
    #[test]
    fn counters_advance_per_packet() {
        let socket = ready_socket();
        socket.sequence.store(u16::MAX, Ordering::Relaxed);
        socket.timestamp.store(u32::MAX - 100, Ordering::Relaxed);
        socket.counter.store(u32::MAX, Ordering::Relaxed);

        let mut out = Vec::new();
        socket.packet_into(b"a", &mut out).unwrap();
        socket.packet_into(b"b", &mut out).unwrap();

        assert_eq!(socket.sequence.load(Ordering::Relaxed), 1);
        assert_eq!(
            socket.timestamp.load(Ordering::Relaxed),
            (u32::MAX - 100).wrapping_add(2 * TIMESTAMP_INC)
        );
        assert_eq!(socket.counter.load(Ordering::Relaxed), 1, "wrap u32::MAX -> 0 -> 1");
    }

    /// Счётчик nonce не сбрасывается ни `initialize`, ни `destroy`:
    /// повтор того же ключа не повторяет nonce.
    #[test]
    fn nonce_counter_survives_reinitialize_and_destroy() {
        let socket = ready_socket();
        socket.counter.store(1_000, Ordering::Relaxed);

        let mut out = Vec::new();
        socket.packet_into(b"x", &mut out).unwrap(); // использован 1000

        socket.destroy();
        assert_eq!(socket.counter.load(Ordering::Relaxed), 1_001);

        socket.initialize(SSRC, KEY.to_vec()).unwrap();
        assert_eq!(socket.counter.load(Ordering::Relaxed), 1_001);

        socket.packet_into(b"y", &mut out).unwrap();
        assert_eq!(&out[out.len() - NONCE_COUNTER_SIZE..], &1_001u32.to_be_bytes());
    }

    /// `destroy` возвращает сокет в неинициализированное состояние.
    #[test]
    fn destroy_clears_state() {
        let socket = ready_socket();
        assert!(socket.is_initialized());
        socket.destroy();
        assert!(!socket.is_initialized());
        socket.destroy(); // повторный вызов безопасен
    }

    /// Пропуск кадров двигает timestamp, но не sequence.
    #[test]
    fn advance_timestamp_leaves_sequence_alone() {
        let socket = ready_socket();
        socket.sequence.store(5, Ordering::Relaxed);
        socket.timestamp.store(0, Ordering::Relaxed);

        socket.advance_timestamp(3);

        assert_eq!(socket.sequence.load(Ordering::Relaxed), 5);
        assert_eq!(socket.timestamp.load(Ordering::Relaxed), 3 * TIMESTAMP_INC);
    }

    /// `wipe` и охранник действительно обнуляют буфер.
    #[test]
    fn wipe_zeroes_buffer() {
        let mut buf = vec![0xAAu8; 32];
        wipe(&mut buf);
        assert!(buf.iter().all(|&b| b == 0));
    }
}