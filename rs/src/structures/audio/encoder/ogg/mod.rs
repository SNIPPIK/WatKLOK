mod packet_type;
mod opus_specification;

use bytes::{Buf, BufMut, BytesMut};
use napi::bindgen_prelude::*;
use memchr::memmem;
use crate::structures::audio::{
    encoder::ogg::packet_type::{PacketType, ParsedPacket}
};
use crate::structures::audio::opus::SILENT_FRAME;
// ============================================================================
// LIMITS
// ============================================================================

// Жёсткий потолок на размер `remainder`. Защита от бесконечного роста
// при мусорном/повреждённом входе, где "OggS" не находится вовсе.
//
// Максимальная Ogg-страница — 27 + 255 + 255*255 = 65 307 байт, и она может
// накапливаться в `remainder` частями. Прежний лимит в 64 КиБ срабатывал
// ложно: почти полная страница (до ~65 КБ) + очередной фрагмент 16 КБ от reader'а
// превышали его и обнуляли состояние парсера на совершенно валидном потоке.
// 256 КиБ = две максимальные страницы + запас на фрагмент.
const MAX_REMAINDER_SIZE: usize = 256 * 1024;

// Если ёмкость `packet_carry` после завершённого пакета выросла выше этого
// порога (например, из-за большого OpusTags), возвращаем её к обычной —
// иначе до конца жизни движка держится вплоть до MAX_PACKET_SIZE (4 МиБ).
const CARRY_SHRINK_THRESHOLD: usize = 64 * 1024;

// Нормальная стартовая ёмкость `packet_carry`.
const CARRY_BASE_CAPACITY: usize = 1024;

// Жёсткий потолок на собираемый Opus-пакет. Защита от пакета, у которого
// lacing-таблица бесконечно говорит "продолжение" (255, 255, 255, ...).
const MAX_PACKET_SIZE: usize = 4 * 1024 * 1024;

// ============================================================================
// PARSER
// ============================================================================

/// Потоковый парсер Ogg-контейнера, извлекающий Opus-пакеты.
///
/// # Привязка к первому логическому потоку (аналог поведения TS-парсера)
///
/// Ogg допускает мультиплексирование нескольких логических потоков
/// (`serial`) в одном физическом контейнере (chained/multiplexed Ogg).
/// Как только в одном из потоков встречается `OpusHead`, этот serial
/// запоминается как основной (`primary_serial`), и все последующие
/// пакеты из ДРУГИХ потоков молча отбрасываются (не публикуются как
/// `Frame`/`Silent`/`Broken`), кроме `Tags` — заголовок комментариев
/// вызывается независимо от serial, как и в исходном TS-парсере.
///
/// Это НЕ влияет на разбор пакетов, переносимых между Ogg-страницами:
/// перенос обрабатывается персистентным `packet_carry` и корректно
/// работает даже когда последний lacing-байт страницы равен 255
/// (в отличие от портированного один-в-один TS-алгоритма, который в
/// этом случае зависает — см. пояснение в сопроводительном ответе).
#[derive(Debug)]
pub struct OggOpusDemuxer {
    /// Буфер для накопления входных данных, не образующих полную Ogg-страницу.
    /// После обработки всех полных страниц остаток сдвигается в начало буфера.
    remainder: BytesMut,

    /// Буфер для сборки пакета, который может начинаться на одной странице
    /// и продолжаться на следующей (сегменты длиной 255 байт).
    packet_carry: Vec<u8>,

    /// Serial страницы, из которой сейчас собирается `packet_carry`.
    /// Используется для решения "сбросить ли carry при смене потока".
    bitstream_serial: Option<u32>,

    /// Serial потока, в котором был найден первый `OpusHead`.
    /// `None`, пока заголовок ещё не встречен ни в одном потоке.
    primary_serial: Option<u32>
}

impl Default for OggOpusDemuxer {
    fn default() -> Self {
        Self::new()
    }
}

impl OggOpusDemuxer {
    /// Создаёт новый демультиплексор с начальными буферами.
    /// `remainder` — накопительный буфер для неполных Ogg-страниц,
    /// `packet_carry` — перенос незавершённого Opus-пакета между страницами,
    /// `bitstream_serial` — идентификатор текущего логического потока.
    pub fn new() -> Self {
        OggOpusDemuxer {
            remainder: BytesMut::new(),
            packet_carry: Vec::with_capacity(CARRY_BASE_CAPACITY),
            bitstream_serial: None,
            primary_serial: None
        }
    }

    // Сколько байт сейчас "застряло" внутри парсера (неполная страница + не полный фрейм).
    // Полезно вызывающему для диагностики/backpressure.
    pub fn pending_len(&self) -> usize {
        self.remainder.len() + self.packet_carry.len()
    }

    /// Точка входа для разбора фрагмента данных.
    ///
    /// Если `chunk` пуст — ничего не делает (в текущей реализации flush)
    /// Иначе запускает основной парсер с возвратом, который склеивает
    /// переданные части в один непрерывный `Vec<u8>` и добавляет
    /// в `output` вместе с типом пакета.
    ///
    /// # Аргументы
    /// * `chunk` — новый фрагмент данных.
    /// * `output` — вектор, куда складываются готовые пакеты.
    ///
    /// # Возвращаемое значение
    /// `Ok(())` при успешном разборе; `Err` при ошибке из возврата.
    pub fn parse_internal(&mut self, chunk: &[u8], output: &mut Vec<ParsedPacket>) -> Result<()> {
        // Пустой chunk трактуется как "конец потока" — до-выдаём то,
        // что осталось в packet_carry, не дожидаясь следующей страницы.
        if chunk.is_empty() {
            return self.flush_internal(output);
        }

        // Замыкание копирует данные в Vec — сам парсер владеет только
        // временным packet_carry и не сохраняет ссылок в output.
        self.parse_core(chunk, |packet_type, data| {
            output.push((packet_type, Vec::from(data)));
            Ok(())
        })
    }

    /// Выдаёт последний собранный, но ещё не завершённый пакет (EOF).
    ///
    /// Тип определяется через `classify`, с учётом текущего
    /// `bitstream_serial` — так же, как и для пакетов, завершённых внутри
    /// обычного потока разбора.
    fn flush_internal(&mut self, output: &mut Vec<ParsedPacket>) -> Result<()> {
        if !self.packet_carry.is_empty() {
            let packet = std::mem::take(&mut self.packet_carry);
            let packet_type = self.classify(&packet, self.bitstream_serial);
            output.push((packet_type, packet));
        }
        Ok(())
    }

    /// Основной цикл разбора.
    ///
    /// Шаги:
    /// 1. Добавляет новые данные в `remainder`.
    /// 2. Ищет сигнатуру "OggS".
    /// 3. Проверяет заголовок страницы.
    /// 4. Обрабатывает полные страницы через `handle_page_core`.
    /// 5. Удаляет обработанные байты из `remainder`.
    ///
    /// # Аргументы
    /// * `chunk` — новые данные.
    /// * `on_packet` — возврат, получающий тип и части пакета.
    fn parse_core<F>(&mut self, chunk: &[u8], mut on_packet: F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        self.remainder.put_slice(chunk);

        // Защита от неограниченного роста при повреждённом входе.
        // Полный сброс — самый простой способ не копить мусор: теряем
        // текущий контекст, но не даём процессу упасть по OOM.
        if self.remainder.len() > MAX_REMAINDER_SIZE {
            self.remainder.clear();
            self.packet_carry.clear();
            return Err(Error::from_reason("Ogg parser remainder overflow"));
        }

        // Минимальный размер Ogg-страницы = 27 байт (fixed header).
        // Меньше — нечего разбирать даже теоретически.
        while self.remainder.len() >= 27 {
            // Ищем начало следующей страницы. Если "OggS" нет совсем,
            // оставляем последние 3 байта — там может быть "Ogg" + "S"
            // на следующей итерации после put_slice.
            let pos = match memmem::find(&self.remainder, b"OggS") {
                Some(pos) => pos,
                None => {
                    if self.remainder.len() > 3 {
                        let discard_len = self.remainder.len() - 3;
                        self.remainder.advance(discard_len);
                    }
                    return Ok(());
                }
            };

            // Сдвигаем начало буфера к найденной сигнатуре. Мусор до неё
            // просто теряется — это ожидаемое поведение ре-синхронизации.
            if pos > 0 {
                self.remainder.advance(pos);
                debug_assert_eq!(&self.remainder[..4], b"OggS");
            }

            // 27 байт фикс. Заголовка + N байт lacing-таблицы.
            // N хранится в байте 26 (счётчик сегментов).
            let header_size = 27 + self.remainder[26] as usize;
            if self.remainder.len() < header_size {
                break;
            }

            let segment_table = &self.remainder[27..header_size];
            let mut payload_size = 0usize;
            for &segment in segment_table {
                payload_size += segment as usize;
            }

            // Полный размер страницы = заголовок + тело.
            // Ждём, пока придут все байты, иначе — break и выход из цикла.
            let page_end = header_size + payload_size;
            if self.remainder.len() < page_end {
                break;
            }

            let full_page = &self.remainder[..page_end];

            // Handle_page_core может вернуть Err — это НЕ фатально:
            // например, если внутри одной "страницы" встретился пакет
            // с overflow. В этом случае сдвигаемся на минимум 4 байта
            // и пробуем снова найти "OggS" — так мы не зациклимся.
            if Self::handle_page_core(
                full_page,
                &mut self.packet_carry,
                &mut self.bitstream_serial,
                &mut self.primary_serial,
                &mut on_packet,
            )
                .is_err()
            {
                self.remainder.advance(header_size.min(4));
                continue;
            }

            self.remainder.advance(page_end);
        }

        Ok(())
    }

    /// Обрабатывает одну полную Ogg-страницу: разбивает её тело на пакеты
    /// по lacing-таблице, собирает продолжения через `packet_carry` и
    /// вызывает готовые пакеты через `on_packet`.
    ///
    /// # Роль в общем парсере
    ///
    /// Вызывается из `parse_core` для каждой страницы, у которой уже есть
    /// все байты (заголовок + тело). Сама страница позиционируется как
    /// `page[0..]` = `OggS` + фикс. Заголовок + lacing-таблица + payload;
    /// смещения внутри функции жёстко привязаны к этой раскладке.
    ///
    /// # Состояние (передаётся по &mut, живёт между вызовами)
    ///
    /// - `packet_carry` — персистентный буфер для пакета, который начался
    ///   на предыдущей странице (последний lacing-байт был 255) и
    ///   продолжается на текущей. Сбрасывается при смене потока и при
    ///   не-continued странице.
    /// - `bitstream_serial` — serial последней обработанной страницы.
    ///   Нужен, чтобы заметить переход на другой логический поток и
    ///   не склеивать через границу чужие друг другу данные.
    /// - `primary_serial` — serial "основного" потока. Заполняется лениво:
    ///   первый же `Head`, увиденный в `classify_static`, защёлкивает здесь
    ///   свой serial. Пока `None`, любой не-Head отдаётся как `Unclassified`.
    ///
    /// # Фильтрация потоков
    ///
    /// Пакеты из потока `serial == *primary_serial` вызова как есть.
    /// Пакеты из любого другого потока (а также всё до первого `Head`)
    /// подменяются на `PacketType::PLC` с содержимым `SILENT_FRAME` —
    /// это сохраняет тайминги у потребителя, но не пропускает в основной
    /// поток данные чужого источника.
    ///
    /// # Поведение `on_packet`
    ///
    /// Вызывается один раз на каждый завершённый пакет (lacing-байт < 255,
    /// либо явный нулевой сегмент). Может вернуть `Err` — тогда обработка
    /// страницы немедленно прерывается и ошибка уходит вызывающему.
    ///
    /// # Ошибки
    ///
    /// - `"Invalid OGG page"` — `page` короче 27 байт.
    /// - `"Segment out of bounds"` — lacing-таблица обещает больше байт,
    ///   чем реально лежит в `page` (повреждённая/обрезанная страница).
    /// - `"Opus packet overflow"` — накопленный `packet_carry` превысил
    ///   `MAX_PACKET_SIZE`. При этом carry сбрасывается и ужимается до
    ///   `CARRY_BASE_CAPACITY`, чтобы не тащить раздутый буфер дальше.
    ///
    /// # Инварианты
    ///
    /// - `segments_count = page[26]`; `segment_table` — это байты
    ///   `page[27..27+segments_count]`. Функция доверяет этим данным;
    ///   размер `page` уже проверен вызывающим (полная страница).
    /// - После успешного прохода `offset` указывает за последний
    ///   прочитанный байт тела страницы
    fn handle_page_core<F>(page: &[u8], packet_carry: &mut Vec<u8>, bitstream_serial: &mut Option<u32>, primary_serial: &mut Option<u32>, on_packet: &mut F) -> Result<()> where
        F: FnMut(PacketType, &[u8]) -> Result<()>,
    {
        if page.len() < 27 {
            return Err(Error::from_reason("Invalid OGG page"));
        }

        // Флаги заголовка Ogg:
        // 0x01 — continued (страница продолжает пакет с предыдущей),
        let header_type = page[5];
        let continued = (header_type & 0x01) != 0;

        // Serial логического потока — 4 байта LE со смещения 14.
        let serial = u32::from_le_bytes(page[14..18].try_into().unwrap());

        // При смене serial сбрасываем незавершённый пакет: он принадлежит
        // другому логическому потоку, склеивать его с новым нельзя.
        if *bitstream_serial != Some(serial) {
            packet_carry.clear();
            *bitstream_serial = Some(serial);
        }

        let segments_count = page[26] as usize;
        let segment_table = &page[27..27 + segments_count];
        let mut offset = 27 + segments_count;

        // Если страница НЕ помечена continued, но carry непустой —
        // это рассинхрон: старая "половинка" пакета недействительна.
        if !continued && !packet_carry.is_empty() {
            packet_carry.clear();
        }

        for &segment_len in segment_table {
            let segment_len = segment_len as usize;
            let end = offset + segment_len;

            // Проверяем размер ДО следующей итерации, чтобы не копить больше MAX_PACKET_SIZE
            if packet_carry
                .len()
                .saturating_add(segment_len) > MAX_PACKET_SIZE
            {
                packet_carry.clear();
                packet_carry.shrink_to(CARRY_BASE_CAPACITY);

                return Err(Error::from_reason("Opus packet overflow"));
            }

            {
                // Выделяем размер под новый пакет данных
                let data = page.get(offset..end).ok_or_else(|| Error::from_reason("Segment out of bounds"))?;
                packet_carry.extend_from_slice(data);
                offset = end;
            }

            // Проверка на допустимый диапазон размера
            if segment_len == 0 || segment_len < 255 && !packet_carry.is_empty() {
                // Получение типа пакета
                let packet_type = PacketType::classify_static(packet_carry, serial, primary_serial);

                // Если код потока соответствует
                if Some(serial) == *primary_serial {
                    on_packet(packet_type, packet_carry)?;
                    packet_carry.clear();
                }
                // Если код был нарушен заполним пустотой для сглаживания
                else {
                    on_packet(PacketType::PLC, &SILENT_FRAME)?;
                }

                // Сброс carry — всегда, независимо от should_emit:
                // пакет собран, дальше пойдёт следующий.
                if packet_carry.capacity() > CARRY_SHRINK_THRESHOLD {
                    packet_carry.shrink_to(CARRY_BASE_CAPACITY);
                }
            }
        }

        Ok(())
    }


    /// Версия для `flush_internal`, где нет доступа к `&mut self` полям
    /// напрямую в замыкании — использует уже известный `bitstream_serial`.
    #[inline]
    pub fn classify(&self, packet: &[u8], serial: Option<u32>) -> PacketType {
        let detected = PacketType::detect_packet_type(packet);
        match (detected, serial, self.primary_serial) {
            // Head всегда Head, независимо от потока — вызывающий сам
            // решает, что с ним делать.
            (PacketType::Head, _, _) => PacketType::Head,

            // Пакет из основного потока — отдаём как есть.
            (_, Some(s), Some(p)) if s == p => detected,

            // primary_serial ещё не найден — всё непонятное в Unclassified.
            (_, _, None) => PacketType::Unclassified,

            // Всё прочее (в т.ч. чужой поток) — Unclassified.
            _ => PacketType::Unclassified,
        }
    }

    // Полный сброс состояния парсера. Используется в Drop и может
    // вызываться вручную при смене входного потока.
    pub fn cleanup(&mut self) {
        self.remainder.clear();
        self.packet_carry.clear();
        self.packet_carry.shrink_to(CARRY_BASE_CAPACITY);
        self.bitstream_serial = None;
        self.primary_serial = None;
    }
}

impl Drop for OggOpusDemuxer {
    fn drop(&mut self) {
        self.cleanup();
    }
}


// Тесты для OggOpusDemuxer и PacketType::classify_static.
// Модуль собран по группам — каждая группа проверяет свой слой:
//   1. parse_internal: end-to-end (склейка страниц, ресинк, overflow);
//   2. flush_internal через пустой chunk (EOF-поведение);
//   3. pending_len и cleanup (управление состоянием);
//   4. classify (чистая функция от (packet, serial, primary));
//   5. особые случаи handle_page_core, дотягиваемые через публичный API.
#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------
    // Хелперы
    // ---------------------------------------------------------------

    // Собирает Ogg-страницу из сегментов и payload.
    // Ассерты ловят ошибки в самих тестах: несовпадение lacing-таблицы
    // с payload или переполнение однобайтового счётчика сегментов.
    // Поля granule/seq/crc не заполняются — парсер их не читает.
    fn build_page(serial: u32, header_type: u8, segments: &[u8], payload: &[u8]) -> Vec<u8> {
        assert!(segments.len() <= 255, "lacing-таблица не влезет в один байт");
        // Сумма длин сегментов в lacing-таблице должна совпасть с payload —
        // иначе тест собрал бы структурно невалидную страницу.
        let total: usize = segments.iter().map(|&b| b as usize).sum();
        assert_eq!(total, payload.len(), "lacing-таблица не сходится с payload");

        let mut page = Vec::new();
        page.extend_from_slice(b"OggS");
        page.push(0);
        page.push(header_type);
        page.extend_from_slice(&[0u8; 8]);              // granule
        page.extend_from_slice(&serial.to_le_bytes());
        page.extend_from_slice(&[0u8; 4]);              // seq
        page.extend_from_slice(&[0u8; 4]);              // crc
        page.push(segments.len() as u8);
        page.extend_from_slice(segments);
        page.extend_from_slice(payload);
        page
    }

    /// OpusHead — минимальная сигнатура (остальное парсер не читает).
    // Достаточно 8 байт "OpusHead" + добивка до 19 нулями: classify_static
    // смотрит только на префикс, валидность остальных полей не проверяется.
    fn opus_head_payload() -> Vec<u8> {
        let mut v = b"OpusHead".to_vec();
        v.extend_from_slice(&[0u8; 19 - 8]);
        v
    }

    /// Обычный Opus-пакет с TOC config=0.
    // TOC = 0x00 интерпретируется детектором как Frame.
    // Длина регулируется параметром — тесты используют разные размеры.
    fn opus_frame(len: usize) -> Vec<u8> {
        vec![0x00u8; len]
    }

    /// Прогоняет chunk через parse_internal, отдаёт результат и пакеты.
    // Возвращает и Result, и накопленный output — чтобы тест мог
    // одновременно проверить и успешность, и содержимое выдачи.
    fn parse(
        demuxer: &mut OggOpusDemuxer,
        chunk: &[u8],
    ) -> (Result<()>, Vec<(PacketType, Vec<u8>)>) {
        let mut out = Vec::new();
        let res = demuxer.parse_internal(chunk, &mut out);
        (res, out)
    }

    // Проверяет, что результат — Err, и что текст ошибки содержит needle.
    // В tests ожидание Err — норма, но napi::Error не реализует PartialEq,
    // поэтому сравниваем через строковое представление.
    fn assert_err_contains(res: Result<()>, needle: &str) {
        match res {
            Ok(()) => panic!("expected Err containing {needle:?}, got Ok(())"),
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains(needle),
                    "expected error containing {needle:?}, got {msg:?}"
                );
            }
        }
    }

    /// Инициализирует демультиплексор: один Head-пакет от stream #1,
    /// чтобы `primary_serial` защёлкнулся и следующий обычный пакет
    /// прошёл как Frame, а не как PLC.
    // Хелпер-прекондиция для тестов, которым нужен уже зафиксированный
    // primary-поток. Побочный эффект — тесты не проверяют сам факт
    // защёлкивания, только поведение после него.
    fn demuxer_with_primary_head() -> OggOpusDemuxer {
        let mut d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        let page = build_page(1, 0x02, &[head.len() as u8], &head);
        let mut out = Vec::new();
        d.parse_internal(&page, &mut out).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Head);
        d
    }

    // ===============================================================
    // Группа 1. parse_internal: end-to-end поведение
    // ===============================================================

    #[test]
    // Первый Head: (а) публикуется как Head, (б) защёлкивает primary_serial
    // и bitstream_serial. Проверка обеих частей — чтобы не сломать
    // ленивую инициализацию при будущем рефакторинге.
    fn head_page_sets_primary_serial_and_emits_head() {
        let mut d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        let page = build_page(7, 0x02, &[head.len() as u8], &head);

        let (res, out) = parse(&mut d, &page);
        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Head);
        assert_eq!(out[0].1, head);
        assert_eq!(d.primary_serial, Some(7));
        assert_eq!(d.bitstream_serial, Some(7));
    }

    #[test]
    // Пакет из чужого потока после установки primary_serial превращается
    // в PLC с содержимым SILENT_FRAME — потребитель получает "тишину"
    // вместо данных другого потока.
    fn packets_from_non_primary_serial_become_plc() {
        let mut d = demuxer_with_primary_head(); // primary = 1

        let frame = opus_frame(20);
        let page = build_page(2, 0x00, &[20], &frame);
        let (res, out) = parse(&mut d, &page);

        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::PLC);
        assert_eq!(&out[0].1[..], &SILENT_FRAME[..]);
    }

    #[test]
    // Положительный кейс: поток совпадает с primary_serial — пакет
    // эмитится как есть, с исходными байтами.
    fn packet_from_primary_serial_emitted_as_frame() {
        let mut d = demuxer_with_primary_head();
        let frame = opus_frame(30);
        let page = build_page(1, 0x00, &[30], &frame);

        let (res, out) = parse(&mut d, &page);
        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Frame);
        assert_eq!(out[0].1, frame);
    }

    #[test]
    // Три страницы в одном chunk: цикл разбора должен обработать все,
    // а не остановиться на первой. Head пройдёт первым, два Frame — следом,
    // в исходном порядке (FIFO).
    fn multiple_pages_in_one_chunk_all_processed() {
        let mut d = OggOpusDemuxer::new();

        let head = opus_head_payload();
        let f1 = opus_frame(10);
        let f2 = opus_frame(15);

        let mut chunk = Vec::new();
        chunk.extend_from_slice(&build_page(1, 0x02, &[head.len() as u8], &head));
        chunk.extend_from_slice(&build_page(1, 0x00, &[10], &f1));
        chunk.extend_from_slice(&build_page(1, 0x00, &[15], &f2));

        let (res, out) = parse(&mut d, &chunk);
        assert!(res.is_ok());
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].0, PacketType::Head);
        assert_eq!(out[1], (PacketType::Frame, f1));
        assert_eq!(out[2], (PacketType::Frame, f2));
    }

    #[test]
    // Стриминг по кускам: страница приходит по частям, парсер должен
    // накапливать remainder и не эмитить ничего, пока страница не полна.
    fn partial_page_is_buffered_until_remainder_arrives() {
        let mut d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        let page = build_page(1, 0x02, &[head.len() as u8], &head);

        // Отдаём всё, кроме последних 3 байт.
        let (res1, out1) = parse(&mut d, &page[..page.len() - 3]);
        assert!(res1.is_ok());
        assert!(out1.is_empty(), "неполная страница не должна ничего отдавать");
        assert!(d.pending_len() > 0);

        // Догоняем недостающие байты — страница собирается целиком.
        let (res2, out2) = parse(&mut d, &page[page.len() - 3..]);
        assert!(res2.is_ok());
        assert_eq!(out2.len(), 1);
        assert_eq!(out2[0].0, PacketType::Head);
    }

    #[test]
    // Ресинк: перед "OggS" лежит мусор — парсер должен его проглотить
    // и всё равно найти и обработать валидную страницу.
    fn resyncs_on_garbage_prefix_before_oggs() {
        let mut d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        let page = build_page(1, 0x02, &[head.len() as u8], &head);

        let mut chunk = vec![0xAAu8; 128];
        chunk.extend_from_slice(&page);

        let (res, out) = parse(&mut d, &chunk);
        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Head);
    }

    #[test]
    // Мусор без единого "OggS": парсер не должен ни падать, ни копить
    // всё в remainder. На выходе — пусто, в остатке — не больше 3 байт
    // (потенциальный префикс "OggS", который может прийти в следующем chunk).
    fn garbage_without_oggs_does_not_blow_up() {
        let mut d = OggOpusDemuxer::new();
        let junk = vec![0x55u8; 1000];

        let (res, out) = parse(&mut d, &junk);
        assert!(res.is_ok());
        assert!(out.is_empty());
        // Должны остаться максимум последние 3 байта для склейки "OggS".
        assert!(d.remainder.len() <= 3);
    }

    #[test]
    // Защита от OOM: если вход копит мусор без "OggS" и remainder
    // превышает MAX_REMAINDER_SIZE — возвращается ошибка, всё состояние
    // сбрасывается. Тест проверяет и Err, и то, что буферы реально пусты.
    fn remainder_overflow_resets_state_and_errors() {
        let mut d = OggOpusDemuxer::new();
        // Заведомо больше MAX_REMAINDER_SIZE и без "OggS".
        let junk = vec![0xCCu8; MAX_REMAINDER_SIZE + 16];

        let (res, out) = parse(&mut d, &junk);
        assert!(out.is_empty());
        assert_err_contains(res, "Ogg parser remainder overflow");
        assert_eq!(d.remainder.len(), 0);
        assert_eq!(d.packet_carry.len(), 0);
    }

    // ===============================================================
    // Группа 2. flush_internal (через пустой chunk)
    // ===============================================================

    #[test]
    // Пустой chunk трактуется как EOF. Если carry тоже пуст —
    // это no-op: нечего выдавать, ошибок нет.
    fn empty_chunk_with_empty_carry_is_noop() {
        let mut d = OggOpusDemuxer::new();
        let (res, out) = parse(&mut d, &[]);
        assert!(res.is_ok());
        assert!(out.is_empty());
    }

    #[test]
    // Незавершённый пакет (lacing=255 без продолжения) должен быть
    // выдан через flush при EOF. Тип определяется через classify,
    // с использованием актуального bitstream_serial.
    fn empty_chunk_flushes_pending_partial_packet() {
        let mut d = OggOpusDemuxer::new();

        // Прогреваем primary_serial Head-пакетом.
        let head = opus_head_payload();
        let mut out = Vec::new();
        d.parse_internal(&build_page(1, 0x02, &[head.len() as u8], &head), &mut out)
            .unwrap();
        out.clear();

        // Открываем незавершённый Frame (lacing=255).
        let part = opus_frame(255);
        d.parse_internal(&build_page(1, 0x00, &[255], &part), &mut out)
            .unwrap();
        assert!(out.is_empty());
        assert_eq!(d.packet_carry.len(), 255);

        // Пустой chunk = EOF => должен выдать накопленное.
        d.parse_internal(&[], &mut out).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Frame);
        assert_eq!(out[0].1, part);
        assert!(d.packet_carry.is_empty());
    }

    #[test]
    // Редкий сценарий: OpusHead не закрылся на странице (lacing=255),
    // т.е. целиком лежит в carry. flush обязан распознать его как Head
    // и защёлкнуть primary_serial (через classify_static в flush_internal).
    // NB: тест проверяет только выдачу; защёлкивание primary_serial
    // отдельно не ассертится.
    fn flush_classifies_head_when_carry_holds_whole_head() {
        let mut d = OggOpusDemuxer::new();
        let mut out = Vec::new();

        // Head целиком лежит в одном незавершённом сегменте (lacing=255).
        // primary_serial ещё не установлен — пакет не отдан.
        let mut payload = opus_head_payload();
        payload.resize(255, 0);
        d.parse_internal(&build_page(9, 0x00, &[255], &payload), &mut out)
            .unwrap();
        assert!(out.is_empty());

        // flush => тип должен определиться как Head.
        d.parse_internal(&[], &mut out).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Head);
        assert_eq!(out[0].1, payload);
    }

    #[test]
    // Симметричный кейс: в carry лежат нераспознаваемые байты и
    // primary_serial ещё нет. flush не может классифицировать пакет —
    // возвращает Unclassified, но не теряет данные.
    fn flush_of_unknown_bytes_without_primary_yields_unclassified() {
        let mut d = OggOpusDemuxer::new();
        let mut out = Vec::new();

        let junk = vec![0x77u8; 255];
        d.parse_internal(&build_page(1, 0x00, &[255], &junk), &mut out)
            .unwrap();

        d.parse_internal(&[], &mut out).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Unclassified);
        assert_eq!(out[0].1, junk);
    }

    // ===============================================================
    // Группа 3. pending_len и cleanup
    // ===============================================================

    #[test]
    // pending_len = remainder.len() + packet_carry.len().
    // Проверяем в двух фазах: (1) после открытия carry,
    // (2) после накопления ещё и неполной следующей страницы в remainder.
    fn pending_len_accounts_for_remainder_and_carry() {
        let mut d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        let mut out = Vec::new();
        d.parse_internal(&build_page(1, 0x02, &[head.len() as u8], &head), &mut out)
            .unwrap();
        out.clear();

        // Незавершённый Frame оставляет байты в carry.
        let part = opus_frame(255);
        let page = build_page(1, 0x00, &[255], &part);
        d.parse_internal(&page, &mut out).unwrap();
        assert!(out.is_empty());
        assert_eq!(d.pending_len(), d.remainder.len() + d.packet_carry.len());
        assert_eq!(d.packet_carry.len(), 255);

        // Половина следующей страницы — попадёт в remainder.
        let page2 = build_page(1, 0x01, &[10], &opus_frame(10));
        d.parse_internal(&page2[..page2.len() - 5], &mut out).unwrap();
        assert_eq!(d.pending_len(), d.remainder.len() + d.packet_carry.len());
    }

    #[test]
    // cleanup должен обнулить все четыре поля состояния. Проверка
    // всех полей — чтобы при добавлении нового поля состояния тест
    // сразу это заметил.
    fn cleanup_clears_all_state() {
        let mut d = demuxer_with_primary_head();
        assert!(d.primary_serial.is_some());
        assert!(d.bitstream_serial.is_some());

        d.cleanup();

        assert!(d.remainder.is_empty());
        assert!(d.packet_carry.is_empty());
        assert!(d.bitstream_serial.is_none());
        assert!(d.primary_serial.is_none());
        assert_eq!(d.pending_len(), 0);
    }

    #[test]
    // После cleanup объект полностью "как новый": может принять
    // другой Head и защёлкнуть другой primary_serial. Регрессия против
    // ситуации, когда какой-то из счётчиков/буферов не сброшен.
    fn after_cleanup_demuxer_accepts_new_head() {
        let mut d = demuxer_with_primary_head();
        d.cleanup();

        let head = opus_head_payload();
        let page = build_page(42, 0x02, &[head.len() as u8], &head);
        let (res, out) = parse(&mut d, &page);

        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Head);
        assert_eq!(d.primary_serial, Some(42));
    }

    // ===============================================================
    // Группа 4. classify
    // ===============================================================

    // classify — публичный метод, но по сути чистая функция:
    // (packet, serial) x self.primary_serial -> PacketType.
    // Тесты фиксируют контракт всех веток match.

    #[test]
    // Head всегда классифицируется как Head независимо от serial и
    // от того, установлен ли primary_serial. Это важно: второй Head
    // (из чужого потока) тоже пройдёт как Head, и вызывающий сам
    // должен решать, что с ним делать.
    fn classify_head_is_head_regardless_of_serial() {
        let d = OggOpusDemuxer::new();
        let head = opus_head_payload();
        // Ни primary, ни serial — всё равно Head.
        assert_eq!(d.classify(&head, None), PacketType::Head);
        assert_eq!(d.classify(&head, Some(123)), PacketType::Head);
    }

    #[test]
    // primary_serial ещё не установлен -> всё, кроме Head, в Unclassified.
    // Соответствует поведению до первого OpusHead: тип определить нельзя.
    fn classify_unclassified_when_primary_unknown() {
        let d = OggOpusDemuxer::new();
        let frame = opus_frame(20);
        assert_eq!(d.classify(&frame, Some(1)), PacketType::Unclassified);
    }

    #[test]
    // Пакет из основного потока — отдаётся как есть, с реальным типом
    // от детектора (здесь Frame).
    fn classify_detected_for_matching_serial() {
        let d = demuxer_with_primary_head(); // primary = 1
        let frame = opus_frame(20);
        assert_eq!(d.classify(&frame, Some(1)), PacketType::Frame);
    }

    #[test]
    // Пакет из чужого потока (не primary) — Unclassified.
    // Так вызывающий (handle_page_core) узнаёт, что это надо
    // подменить на PLC, а не пускать как данные.
    fn classify_unclassified_for_other_serial() {
        let d = demuxer_with_primary_head();
        let frame = opus_frame(20);
        assert_eq!(d.classify(&frame, Some(2)), PacketType::Unclassified);
    }

    #[test]
    // serial == None -> нельзя сверить с primary -> Unclassified.
    // Актуально для flush: если по какой-то причине bitstream_serial
    // ещё не зафиксирован, пакет не полетит как валидный Frame.
    fn classify_none_serial_is_unclassified() {
        let d = demuxer_with_primary_head();
        let frame = opus_frame(20);
        assert_eq!(d.classify(&frame, None), PacketType::Unclassified);
    }

    // ===============================================================
    // Группа 5. Особые случаи handle_page_core через parse_internal
    // ===============================================================

    // handle_page_core — приватный, но все его ветки достижимы через
    // публичный parse_internal. Здесь собраны самые тонкие из них:
    // стыки страниц, битые continued, смена потока, нулевой сегмент.

    #[test]
    // Пакет, разрезанный на две страницы: последний lacing-байт = 255,
    // следующая страница помечена continued. Проверяет и склейку
    // частей, и корректную классификацию собранного пакета.
    fn continued_page_after_255_byte_segment_completes_packet() {
        let mut d = demuxer_with_primary_head();
        let mut out = Vec::new();

        // part1: 255 байт, lacing=255 -> пакет не закрыт.
        let part1 = opus_frame(255);
        d.parse_internal(&build_page(1, 0x00, &[255], &part1), &mut out)
            .unwrap();
        assert!(out.is_empty());

        // part2: continued, lacing=5 -> закрывает пакет.
        let part2 = vec![0u8; 5];
        d.parse_internal(&build_page(1, 0x01, &[5], &part2), &mut out)
            .unwrap();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Frame);
        // Пакет должен быть ровно из двух частей, склеенных в порядке прихода.
        let mut expected = part1;
        expected.extend_from_slice(&part2);
        assert_eq!(out[0].1, expected);
    }

    #[test]
    // Рассинхрон: carry непустой, но страница НЕ помечена continued.
    // Такое возможно при потерях в транспортном слое или при битом
    // контейнере. Старый carry недействителен и должен быть сброшен,
    // новый пакет парсится с нуля.
    fn non_continued_page_discards_stale_carry_before_parsing_new_packet() {
        let mut d = demuxer_with_primary_head();
        let mut out = Vec::new();

        // Копим хвост.
        d.parse_internal(&build_page(1, 0x00, &[255], &opus_frame(255)), &mut out)
            .unwrap();
        assert_eq!(d.packet_carry.len(), 255);

        // Тот же serial, БЕЗ continued — хвост недействителен.
        let fresh = opus_frame(7);
        d.parse_internal(&build_page(1, 0x00, &[7], &fresh), &mut out)
            .unwrap();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].1, fresh);
        assert!(d.packet_carry.is_empty());
    }

    #[test]
    // Смена serial на лету: незавершённый carry от предыдущего потока
    // должен быть отброшен (нельзя склеивать через границу потоков).
    // Новый пакет из чужого (не primary) потока уходит как PLC.
    fn serial_change_discards_pending_carry() {
        let mut d = demuxer_with_primary_head(); // primary = 1
        let mut out = Vec::new();

        // Открываем незавершённый пакет в stream #1.
        d.parse_internal(&build_page(1, 0x00, &[255], &opus_frame(255)), &mut out)
            .unwrap();
        assert_eq!(d.packet_carry.len(), 255);

        // Приходит stream #2 — carry должен очиститься,
        // а пакет из чужого потока отдаётся как PLC.
        let frame = opus_frame(8);
        d.parse_internal(&build_page(2, 0x00, &[8], &frame), &mut out)
            .unwrap();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::PLC);
        assert_eq!(&out[0].1[..], &SILENT_FRAME[..]);
        assert_eq!(d.bitstream_serial, Some(2));
    }

    #[test]
    // Нулевой сегмент (lacing=0) без накопленного carry. По спеке Ogg
    // это означает "пакет нулевой длины завершён". Парсер должен
    // эмитить пакет, а не молча пропустить сегмент.
    // Проверяем и факт эмита, и то, что тип — Broken (пустой пакет
    // не может быть валидным Opus-пакетом, детектор так и решает).
    fn zero_length_segment_emits_empty_frame() {
        let mut d = demuxer_with_primary_head();
        let page = build_page(1, 0x00, &[0], &[]);
        let (res, out) = parse(&mut d, &page);
        assert!(res.is_ok());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, PacketType::Broken);
        assert!(out[0].1.is_empty());
    }
}