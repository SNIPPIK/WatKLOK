use {
    crossbeam_utils::CachePadded,
    std::{
        cell::UnsafeCell,
        mem::MaybeUninit,
        sync::atomic::{AtomicUsize, Ordering}
    }
};

/// Кольцевой буфер для `Vec<u8>` с lock-free доступом к счётчикам.
///
/// # Архитектура
///
/// Producer:
///     - изменяет `head` (Release)
///     - читает `tail` (Acquire)
///
/// Consumer:
///     - изменяет `tail` (Release)
///     - читает `head` (Acquire)
///
/// # Потокобезопасность
/// Стороны сериализуются мьютексами: `producer` для `push_many`, `consumer`
/// для `pop`. Поэтому `&RingBuffer` безопасно делить между любым числом
/// потоков. Мьютексы не конкурируют между собой (producer и consumer берут
/// разные), а `len`/`is_empty`/`is_full` работают без блокировок.
///
/// # Ёмкость
/// Округляется вверх до степени двойки: индексация идёт битовой маской, а
/// счётчики `head`/`tail` корректно переполняются (для остатка от деления
/// на не-степень двойки это было бы не так).
///
/// # Переполнение
/// `push_many` возвращает число записанных пакетов; остаток входного
/// итератора в буфер не попадает и отбрасывается, поэтому вызывающий
/// сравнивает результат с размером пачки и учитывает потери.
pub struct RingBuffer {
    /// Массив слотов. `UnsafeCell<MaybeUninit<Vec<u8>>>` — классическая
    /// схема "сырой слот без инициализации": запись/чтение/дроп вручную,
    /// никакой автоматической инициализации/деструктора у массива нет.
    buffer: Box<[UnsafeCell<MaybeUninit<Vec<u8>>>]>,

    /// Ёмкость (число слотов), степень двойки. Не меняется после `new`.
    capacity: usize,

    /// `capacity - 1`: заменяет `%` на `&` в `index()`.
    mask: usize,

    /// Позиция producer. Меняется ТОЛЬКО producer'ом.
    /// CachePadded — разносит head/tail по разным кэш-линиям,
    /// иначе они будут "драться" за одну линию между двумя ядрами.
    head: CachePadded<AtomicUsize>,

    /// Позиция consumer. Меняется ТОЛЬКО consumer'ом.
    tail: CachePadded<AtomicUsize>,

    /// Сериализует producer-сторону (`push_many`).
    ///
    /// `SocketBuffered::push_packets` вызывается из разных потоков (JS-поток
    /// и tokio). Без блокировки два producer'а писали бы в один слот: пакет
    /// терялся, а `Vec` утекал (`MaybeUninit::write` не вызывает drop).
    /// Незанятый мьютекс стоит ~20 нс, а пакеты идут ~50 раз/с на сессию.
    producer: parking_lot::Mutex<()>,

    /// Сериализует consumer-сторону (`pop`). Без неё два потока, вызвавшие
    /// `pop` одновременно, прочитали бы один слот дважды (double free).
    consumer: parking_lot::Mutex<()>,
}

// SAFETY: слоты пишутся только под мьютексом `producer`, а читаются только
// под `consumer`, поэтому на каждой стороне одновременно работает не более
// одного потока. Между сторонами содержимое слотов синхронизировано
// публикацией `head`/`tail` через Release/Acquire. Значит, безопасны и
// передача владения буфером между потоками (Send), и совместный доступ по
// ссылке (Sync).
//
// NB: компилятор не может доказать корректность этой ручной синхронизации —
// тип с `UnsafeCell` не Send/Sync по умолчанию, поэтому impl'ы ручные.
unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
    /// Создаёт пустой ring buffer.
    ///
    /// `capacity` — максимальное количество одновременно хранимых пакетов;
    /// округляется вверх до степени двойки.
    ///
    /// # Panics
    /// Паникует, если `capacity == 0` или округление переполняет `usize`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "RingBuffer capacity must be greater than zero");

        let capacity = capacity
            .checked_next_power_of_two()
            .expect("RingBuffer capacity is too large");

        // Каждый слот — `MaybeUninit::uninit()`: Vec ещё не создан, дропать
        // его нельзя. Заполнение/дроп — только через явные методы ниже.
        let buffer = (0..capacity)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();

        Self {
            buffer,
            capacity,
            mask: capacity - 1,
            head: CachePadded::new(AtomicUsize::new(0)),
            tail: CachePadded::new(AtomicUsize::new(0)),
            producer: parking_lot::Mutex::new(()),
            consumer: parking_lot::Mutex::new(()),
        }
    }
    
    // ========================================================================
    // Internal
    // ========================================================================

    /// Преобразует логическую (монотонно растущую, с wraparound по `usize`)
    /// позицию в физический индекс слота.
    ///
    /// Head/tail — счётчики-обёртки, а не индексы: они только растут
    /// (с точностью до wrap-around), а реальный слот берётся по маске.
    /// Это избавляет от необходимости отдельно различать "пустой" и "полный".
    /// Так как ёмкость — степень двойки, `2^64` кратно ей, и переполнение
    /// счётчика не сдвигает слоты.
    #[inline(always)]
    fn index(&self, position: usize) -> usize {
        position & self.mask
    }

    // ========================================================================
    // Producer
    // ========================================================================

    /// Пытается добавить несколько пакетов.
    ///
    /// Возвращает количество реально записанных элементов — то есть
    /// непустых пакетов, для которых нашлось место. Именно эта величина
    /// используется для сдвига `head`; на неё же ориентируется вызывающий,
    /// чтобы понять, сколько элементов из входного итератора попало в буфер.
    ///
    /// Пустые пакеты пропускаются молча (бессмысленны для RTP) и НЕ
    /// занимают слот: `written` инкрементируется только для непустых,
    /// поэтому пустой элемент в середине входного потока не отнимает
    /// место у следующего непустого. Это отличается от прежнего поведения
    /// через `.take(free)` — там пустые съедали квоту.
    ///
    /// Если очередь заполнится, хвост входного итератора остаётся
    /// невостребованным — обработку остатка выполняет caller.
    /// Итератор может быть частично потреблён: после набора `free` записанных
    /// пакетов цикл прерывается, всё, что за этим в `values`, не смотрится.
    #[inline]
    pub fn push_many<I>(&self, values: I) -> usize
    where
        I: IntoIterator<Item = Vec<u8>>,
    {
        let _producer = self.producer.lock();

        // head принадлежит producer'у — Relaxed достаточно.
        let head = self.head.load(Ordering::Relaxed);

        // tail пишет consumer, поэтому Acquire: нужно увидеть освобождения
        // слотов ДО того, как мы решим, сколько места доступно.
        let tail = self.tail.load(Ordering::Acquire);

        // Занято. wrapping_sub корректен: обе позиции живут в одном
        // пространстве usize со скруглением — разница всегда осмысленна.
        let used = head.wrapping_sub(tail);

        // saturating_sub — страховка от "фантомного" used > capacity.
        // Под замком producer это невозможно, но стоит 0 тактов.
        let free = self.capacity.saturating_sub(used);

        // Ранний выход: писать некуда. Возвращаем 0 — вызывающий сам
        // поймёт, что пачка не влезла.
        if free == 0 { return 0; }

        let mut written = 0usize;

        // Итерируемся по ВСЕМ элементам. Пустой пакет пропускаем без
        // инкремента `written` — он не занимает слот и не «тратит» квоту.
        //
        // NB: "по ВСЕМ элементам" — неточно. Строкой ниже стоит break,
        // так что итерация прекращается, как только набрано `free`
        // записанных пакетов. Всё, что в `values` после этого, не
        // просматривается (итератор дропается с остатком).
        for value in values {
            // Квота выбрана — выходим. Проверяем ДО пустого, чтобы
            // не крутиться по хвосту из одних пустых после заполнения.
            if written >= free { break; }

            // Пустой пакет — не пишем, не занимаем слот, не считаем.
            // Продолжаем со следующим элементом.
            if value.is_empty() { continue; }

            // Индекс слота: head продвигаем на число УЖЕ записанных
            // пакетов, а не на число просмотренных элементов.
            // slot ∈ [head, head + free) — гарантированно не пересекается
            // с занятой частью [tail, head).
            let index = self.index(head.wrapping_add(written));

            // Слот неинициализирован (MaybeUninit) — пишем без чтения
            // старого значения. Unsafe оправдан замком producer: в этот
            // слот не пишет никто, кроме нас, а consumer его ещё не видит.
            unsafe {
                (*self.buffer[index].get()).write(value);
            }
            written += 1;
        }

        // Единый Release на всю пачку. Если бы публиковали head после
        // каждого push, consumer мог бы проснуться на "половине" пачки;
        // сейчас он увидит всю пачку одним Acquire — что нам и нужно.
        //
        // Пропускаем store при written == 0: нечего публиковать, и лишний
        // write в кэш-линию head был бы бессмысленным.
        if written != 0 {
            self.head.store(head.wrapping_add(written), Ordering::Release);
        }
        written
    }

    // ========================================================================
    // Consumer
    // ========================================================================

    /// Извлекает один пакет. `None` — очередь пуста.
    #[inline(always)]
    pub fn pop(&self) -> Option<Vec<u8>> {
        // Единственный consumer в каждый момент времени: иначе два потока
        // прочитали бы один слот.
        let _consumer = self.consumer.lock();

        // Под замком consumer владеет tail.
        let tail = self.tail.load(Ordering::Relaxed);

        // Producer публикует новые данные через Release.
        // Acquire — увидеть данные в слоте, а не только факт публикации.
        let head = self.head.load(Ordering::Acquire);

        if tail == head {
            return None;
        }

        let index = self.index(tail);

        // Consumer — единственный владелец этого элемента, конкурентов нет.
        // assume_init_read: забираем Vec по значению, слот снова "uninit".
        let value = unsafe { (*self.buffer[index].get()).assume_init_read() };

        // Release: публикуем освобождение слота для producer'а.
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        Some(value)
    }

    /// Текущее количество пакетов (мгновенный snapshot, может устареть сразу
    /// после возврата). Используется для метрик и грубых проверок.
    #[inline]
    pub fn len(&self) -> usize {
        // Acquire на обоих счётчиках — хотим видеть согласованное состояние
        // публикаций и освобождений слотов.
        // NB: это не атомарный snapshot — параллельные push/pop могут
        // случиться между двумя load. Для метрик — приемлемо.
        // `tail` читаем ПЕРВЫМ: он только растёт и никогда не обгоняет `head`.
        // При обратном порядке consumer мог успеть сдвинуть `tail` между
        // двумя load, разность уходила в wrap-around и `min(capacity)`
        // давал ложное «очередь полна».
        let tail = self.tail.load(Ordering::Acquire);
        let head = self.head.load(Ordering::Acquire);
        head.wrapping_sub(tail).min(self.capacity)
    }

    /// `true`, если буфер пуст (snapshot).
    #[inline]
    pub fn is_empty(&self) -> bool {
        // Разные Acquire на разные атомики — согласованности "в один момент"
        // никто не обещает; но для пустоты достаточно, чтобы оба счётчика
        // были равны на момент чтения каждого.
        self.head.load(Ordering::Acquire) == self.tail.load(Ordering::Acquire)
    }

    /// `true`, если буфер заполнен полностью (snapshot; к моменту чтения
    /// результата producer/consumer могли уже изменить состояние).
    #[inline]
    pub fn is_full(&self) -> bool {
        // Head — только под Relaxed (это поле producer'а).
        // Строго говоря, для решения "полон ли" producer должен читать
        // head Relaxed, а tail — Acquire.
        let head = self.head.load(Ordering::Relaxed);
        // tail под Acquire — важно увидеть освобождения от consumer'а.
        let tail = self.tail.load(Ordering::Acquire);

        // Разница не меньше ёмкости — все слоты заняты.
        head.wrapping_sub(tail) >= self.capacity
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /// Полностью очищает буфер.
    ///
    /// Требует эксклюзивного доступа (`&mut self`) — это гарантирует
    /// компилятором, что producer и consumer в этот момент не работают
    /// с буфером (например, через `Arc<RingBuffer>` вызвать `clear()` уже
    /// нельзя, пока живы другие обращения).
    pub fn clear(&mut self) {
        // get_mut() на CachePadded<AtomicUsize> даёт &mut usize: мы
        // единственные, кто вообще может дотронуться до этих полей.
        let tail = *self.tail.get_mut();
        let head = *self.head.get_mut();
        let count = head.wrapping_sub(tail).min(self.capacity);

        // Дропаем только реально занятые слоты.
        // Пустые слоты — MaybeUninit, дропать нечего.
        for offset in 0..count {
            let index = self.index(tail.wrapping_add(offset));
            unsafe {
                (*self.buffer[index].get()).assume_init_drop();
            }
        }

        // Сбрасываем счётчики в 0 — буфер снова "как новый".
        // (В принципе, можно было бы не сбрасывать, а просто сделать
        // head = tail; но обнуление проще для отладки/детерминизма.)
        *self.head.get_mut() = 0;
        *self.tail.get_mut() = 0;
    }
}

impl Drop for RingBuffer {
    fn drop(&mut self) {
        // Через clear(): гарантированно дропаем все живые Vec<u8>,
        // не оставляя утечек. clear() идемпотентен — можно звать
        // после явного вызова, ничего не сломается.
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Хелпер: 4-байтовый пакет, начинающийся с байта n.
    // Просто удобно, чтобы различать элементы в тестах по первому байту.
    fn pkt(n: u8) -> Vec<u8> {
        vec![n; 4]
    }

    /// Кладёт один пакет через `push_many`; `true`, если он записан.
    fn put(rb: &RingBuffer, value: Vec<u8>) -> bool {
        rb.push_many(vec![value]) == 1
    }

    #[test]
    fn push_pop_basic() {
        let rb = RingBuffer::new(4);
        assert!(rb.is_empty());
        assert!(put(&rb, pkt(1)));
        assert!(put(&rb, pkt(2)));
        assert_eq!(rb.len(), 2);
        // FIFO: сначала тот, что положили раньше.
        assert_eq!(rb.pop(), Some(pkt(1)));
        assert_eq!(rb.pop(), Some(pkt(2)));
        assert_eq!(rb.pop(), None);
    }

    #[test]
    fn push_many_rejects_empty_packets() {
        let rb = RingBuffer::new(4);
        assert!(!put(&rb, Vec::new()));
        assert!(rb.is_empty());
    }

    #[test]
    fn push_many_on_full_buffer_writes_nothing() {
        let rb = RingBuffer::new(2);
        assert!(put(&rb, pkt(1)));
        assert!(put(&rb, pkt(2)));
        assert!(rb.is_full());
        assert!(!put(&rb, pkt(3)));
        assert_eq!(rb.len(), 2);
    }

    #[test]
    fn push_many_respects_free_space_and_skips_empty() {
        let rb = RingBuffer::new(4);
        // free == 4. Пустой пакет пропускается без траты квоты,
        // поэтому все 4 непустых влезают.
        let written = rb.push_many(vec![pkt(1), Vec::new(), pkt(2), pkt(3), pkt(4)]);
        assert_eq!(written, 4);
        assert_eq!(rb.len(), 4);
        assert!(rb.is_full());

        // FIFO-порядок сохранён, пустой не оставил "дырки" в слотах.
        assert_eq!(rb.pop(), Some(pkt(1)));
        assert_eq!(rb.pop(), Some(pkt(2)));
        assert_eq!(rb.pop(), Some(pkt(3)));
        assert_eq!(rb.pop(), Some(pkt(4)));
        assert_eq!(rb.pop(), None);
    }

    #[test]
    fn push_many_stops_at_capacity_even_with_empties() {
        let rb = RingBuffer::new(4);
        // Один слот занят -> free == 3.
        assert!(put(&rb, pkt(99)));

        let written = rb.push_many(vec![
            pkt(1), Vec::new(), pkt(2), pkt(3), pkt(4), // непустых 4, влезет 3
        ]);
        assert_eq!(written, 3);
        assert_eq!(rb.len(), 4);
        assert!(rb.is_full());
    }

    #[test]
    fn wraparound_index_correctness() {
        let rb = RingBuffer::new(3); // округляется до 4
        // 10 итераций — head/tail успеют обернуться несколько раз,
        // проверяем, что index() корректно маппит при wraparound.
        for round in 0..10u8 {
            assert!(put(&rb, pkt(round)));
            assert_eq!(rb.pop(), Some(pkt(round)));
        }
    }

    #[test]
    fn capacity_is_rounded_up_to_power_of_two() {
        let rb = RingBuffer::new(8);
        assert_eq!((rb.capacity, rb.mask), (8, 7));

        let rb = RingBuffer::new(5);
        assert_eq!((rb.capacity, rb.mask), (8, 7));

        let rb = RingBuffer::new(1);
        assert_eq!((rb.capacity, rb.mask), (1, 0));
    }

    /// Счётчики переполняются: слоты должны продолжать идти по кругу.
    #[test]
    fn counters_wrap_around_usize_boundary() {
        let rb = RingBuffer::new(4);
        let start = usize::MAX - 2;
        rb.head.store(start, Ordering::Relaxed);
        rb.tail.store(start, Ordering::Relaxed);

        for round in 0..12u8 {
            assert!(put(&rb, pkt(round)));
            assert_eq!(rb.pop(), Some(pkt(round)));
        }
        assert!(rb.is_empty());
    }

    /// Несколько consumer'ов на общем буфере: каждый пакет достаётся ровно
    /// одному из них (раньше это было гонкой на `tail` и double free).
    #[test]
    fn concurrent_consumers_get_each_packet_exactly_once() {
        use std::{
            sync::{atomic::AtomicUsize, Arc},
            thread,
            time::{Duration, Instant},
        };

        const TOTAL: usize = 20_000;

        let rb = Arc::new(RingBuffer::new(64));
        let consumed = Arc::new(AtomicUsize::new(0));
        let deadline = Instant::now() + Duration::from_secs(20);

        let producer = {
            let rb = Arc::clone(&rb);
            thread::spawn(move || {
                let mut next = 0usize;
                while next < TOTAL {
                    let id = (next as u32).to_le_bytes().to_vec();
                    if rb.push_many(vec![id]) == 1 {
                        next += 1;
                    } else {
                        thread::yield_now();
                    }
                }
            })
        };

        let consumers: Vec<_> = (0..3)
            .map(|_| {
                let rb = Arc::clone(&rb);
                let consumed = Arc::clone(&consumed);
                thread::spawn(move || {
                    let mut got = Vec::new();
                    while consumed.load(Ordering::Acquire) < TOTAL && Instant::now() < deadline {
                        match rb.pop() {
                            Some(packet) => {
                                got.push(u32::from_le_bytes(packet[..4].try_into().unwrap()));
                                consumed.fetch_add(1, Ordering::AcqRel);
                            }
                            None => thread::yield_now(),
                        }
                    }
                    got
                })
            })
            .collect();

        producer.join().unwrap();

        let mut all: Vec<u32> = Vec::new();
        for consumer in consumers {
            all.extend(consumer.join().unwrap());
        }
        all.sort_unstable();

        let expected: Vec<u32> = (0..TOTAL as u32).collect();
        assert_eq!(all, expected);
    }

    #[test]
    fn drop_releases_remaining_items() {
        let rb = RingBuffer::new(4);
        assert!(put(&rb, pkt(1)));
        assert!(put(&rb, pkt(2)));
        drop(rb.pop()); // освободили один слот
        assert!(put(&rb, pkt(3)));
    }
}
