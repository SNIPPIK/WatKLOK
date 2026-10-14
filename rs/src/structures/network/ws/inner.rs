use napi::{
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
    bindgen_prelude::*
};
use napi_derive::napi;
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU8},
        Arc
    }
};
use tokio::{
    task::JoinHandle,
    sync::mpsc
};
use tokio_tungstenite::tungstenite::Message;

/// Максимальный размер буфера исходящих сообщений до установки соединения.
///
/// Защищает от неограниченного роста памяти, если `connect()` упал
/// (неверный URL, не отвечающий сервер, зависшее рукопожатие TLS),
/// а JS продолжает пушить `packet = ...` в состояние буферизации.
///
/// При переполнении отбрасываем самые старые сообщения: свежие данные
/// для голоса важнее, потому что старые пакеты к моменту установки
/// соединения всё равно уже неактуальны.
const MAX_PENDING_MESSAGES: usize = 256;

/// Данные одного события, передаваемые в JS-обработчик.
///
/// `event` — имя события (совпадает с тем, что передавалось в `on()`);
/// `payload` — JSON-строка (то, что парсится на JS-стороне);
/// `binary` — бинарные данные, если событие их несёт.
#[napi(object)]
pub struct EmitData {
    /// Имя события.
    pub event: String,

    /// Сериализованный JSON payload, если событие текстовое.
    pub payload: Option<String>,

    /// Бинарные данные, если событие бинарное.
    pub binary: Option<Buffer>
}

/// Потокобезопасная функция, зарегистрированная JS-стороной на событие.
///
/// Последний параметр `false` — не блокирующая: вызовы выполняются
/// в JS-потоке, а не в том, откуда дёргается `call()`.
pub type EventFn = ThreadsafeFunction<
    EmitData,
    (),
    Vec<serde_json::Value>,
    Status,
    false,
>;

/// Состояние отправки сообщений: либо копим в буфере, либо пишем в канал.
///
/// Разделение существует потому, что до установки соединения писать
/// некуда, но вызывающий уже может отправлять пакеты — они должны
/// дождаться подключения и уйти одним потоком, в исходном порядке.
pub enum PacketSink {
    /// Соединение ещё не установлено — сообщения копятся здесь.
    Buffering(Vec<Message>),
    /// Соединение активно — сообщения уходят в неограниченный канал,
    /// который читает задача записи.
    Connected(mpsc::UnboundedSender<Message>),
}

/// Общее состояние WebSocket-клиента.
///
/// Живёт в `Arc<Inner>`, потому что доступ к нему идёт из трёх мест
/// параллельно: JS-обёртка (`VoiceWebSocket`), задача соединения
/// и задача heartbeat.
pub struct Inner {
    /// Текущий способ отправки: буфер или канал.
    /// `Mutex` из `parking_lot` — быстрее стандартного, без отравления.
    sink: Mutex<PacketSink>,

    /// Последний полученный seq от Discord. `-1` — ещё не получен.
    /// Хранится в `AtomicI64`, потому что `-1` не влезает в `u32`,
    /// а приведение знакового к беззнаковому даёт путаницу.
    pub sequence: AtomicI64,

    /// Код состояния соединения (значения из `ws_status`).
    pub status: AtomicU8,

    /// `true`, если соединение активно (установлено и не закрыто).
    pub ready: AtomicBool,

    /// `true`, если объект уничтожен через `destroy()`.
    /// Все публичные методы проверяют этот флаг и отказываются работать.
    pub destroyed: AtomicBool,

    /// `true`, если отправлен heartbeat, но ACK ещё не пришёл.
    /// Используется для обнаружения тайм-аута: если следующий тик
    /// застаёт флаг установленным — значит предыдущий пакет пропал.
    pub hb_pending: AtomicBool,

    /// Задача heartbeat. `Option`, потому что между перезапусками её нет.
    pub hb_task: Mutex<Option<JoinHandle<()>>>,

    /// Задача соединения. Хранится, чтобы уметь прервать её из `reset`.
    pub conn_task: Mutex<Option<JoinHandle<()>>>,

    /// Зарегистрированные JS-обработчики, сгруппированные по имени события.
    /// На одно событие может быть несколько функций — все вызываются.
    pub events: Mutex<HashMap<String, Vec<Arc<EventFn>>>>
}

impl Inner {
    /// Создаёт состояние в исходном виде: соединения нет, буфер пуст.
    /// Возвращает `Arc`, потому что объект живёт в нескольких задачах.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sink: Mutex::new(PacketSink::Buffering(Vec::new())),
            sequence: AtomicI64::new(-1),
            status: AtomicU8::new(crate::structures::network::ws::opcodes::ws_status::CLOSED),
            ready: AtomicBool::new(false),
            destroyed: AtomicBool::new(false),
            hb_pending: AtomicBool::new(false),
            hb_task: Mutex::new(None),
            conn_task: Mutex::new(None),
            events: Mutex::new(HashMap::new())
        })
    }

    // ========================================================================
    // PacketSink
    // ========================================================================

    /// Отправляет сообщение немедленно (если соединение активно) либо
    /// помещает его в буфер (если ещё нет).
    ///
    /// Буфер ограничен `MAX_PENDING_MESSAGES`: при переполнении
    /// освобождаем половину самых старых сообщений. Без этого длинный
    /// сбой соединения приводил бы к неограниченному росту `Vec<Message>`
    /// (утечка памяти).
    pub fn enqueue_or_send(&self, msg: Message) {
        match &mut *self.sink.lock() {
            PacketSink::Connected(tx) => {
                // Канал неограниченный, поэтому отправка не блокируется
                // и не может провалиться — результат `send` не проверяем.
                let _ = tx.send(msg);
            }
            PacketSink::Buffering(queue) => {
                if queue.len() >= MAX_PENDING_MESSAGES {
                    // Освобождаем половину — самые старые. Один проход
                    // с линейной сложностью вместо неё же на каждое
                    // добавление.
                    let drop_count = queue.len() / 2;
                    queue.drain(..drop_count);
                }
                queue.push(msg);
            }
        }
    }

    /// Отправляет сообщение, только если соединение уже активно; иначе
    /// молча отбрасывает (не помещает в буфер).
    ///
    /// Используется для heartbeat: буферизовать его бессмысленно —
    /// к моменту подключения он уже устареет.
    pub fn send_if_connected(&self, msg: Message) {
        if let PacketSink::Connected(tx) = &*self.sink.lock() {
            let _ = tx.send(msg);
        }
    }

    /// Переводит состояние в "подключено": всё, что накопилось в буфере,
    /// уходит в канал в исходном порядке, дальнейшие отправки идут
    /// напрямую в канал.
    pub fn mark_connected(&self, tx: mpsc::UnboundedSender<Message>) {
        let mut sink = self.sink.lock();

        // Сначала переливаем накопленное в тот же канал — порядок
        // сообщений сохраняется (буфер был FIFO, канал тоже FIFO).
        if let PacketSink::Buffering(queue) = &mut *sink {
            for msg in queue.drain(..) {
                let _ = tx.send(msg);
            }
        }

        // Только после перелива заменяем состояние. Если сделать наоборот,
        // накопленное потерялось бы: `Buffering` уже нет, а очередь ещё не
        // перелита.
        *sink = PacketSink::Connected(tx);
    }

    /// Переводит состояние в "отключено": возвращает прежний канал (если
    /// был), чтобы вызывающий мог его освободить и разбудить задачу
    /// записи завершением `rx.recv()`.
    pub fn mark_disconnected(&self) -> Option<mpsc::UnboundedSender<Message>> {
        match std::mem::replace(&mut *self.sink.lock(), PacketSink::Buffering(Vec::new())) {
            PacketSink::Connected(tx) => Some(tx),
            PacketSink::Buffering(_) => None
        }
    }

    // ========================================================================
    // Events
    // ========================================================================

    /// Вызывает событие во все зарегистрированные JS-обработчики.
    ///
    /// Обработчики клонируются под мьютексом и вызываются ПОСЛЕ его
    /// освобождения. Раньше `self.events.lock()` удерживался во время
    /// `cb.call()`, что давало два риска:
    ///
    /// 1. **Взаимная блокировка с JS-потоком.** Если JS-обработчик
    ///    попытается подписаться на новое событие (`ws.on(...)`),
    ///    `events.lock()` уже удерживается из потока runtime'а, а JS-поток
    ///    будет ждать его освобождения.
    /// 2. **Лишняя конкуренция.** На каждый `binary`-пакет (50 раз в
    ///    секунду) любой другой поток, желающий работать с событиями,
    ///    ждал бы окончания вызова napi.
    ///
    /// `EventFn` — это обёртка над `Arc` внутри napi, `clone()` — атомарный
    /// инкремент счётчика ссылок, дешевле любой конкуренции за мьютекс.
    ///
    /// Для всех обработчиков, кроме последнего, `payload` и `binary`
    /// клонируются. Последнему владение передаётся без копирования.
    pub fn emit(&self, event: &str, payload_json: Option<String>, binary: Option<Vec<u8>>) {
        // Снимок обработчиков под мьютексом. `Vec<Arc<_>>::clone` —
        // это N инкрементов счётчика ссылок, дешевле удержания мьютекса
        // на время napi-вызовов.
        let callbacks: Vec<Arc<EventFn>> = {
            let events = self.events.lock();
            match events.get(event) {
                Some(cbs) if !cbs.is_empty() => cbs.clone(),
                // Нет обработчиков — событие просто некому доставить.
                _ => return
            }
        };

        // Мьютекс освобождён — работаем со снимком. Ни один другой поток
        // не блокируется на `events.lock()` во время вызовов napi.
        let Some((last, rest)) = callbacks.split_last() else { return; };

        for cb in rest {
            // Копируем данные для всех, кроме последнего. `cb: &Arc<EventFn>`
            // автоматически разыменовывается до `&EventFn`, поэтому `call()`
            // работает как обычно.
            let data = EmitData {
                event: event.to_string(),
                payload: payload_json.clone(),
                binary: binary.as_ref().map(|b| Buffer::from(b.clone())),
            };
            let _ = cb.call(data, ThreadsafeFunctionCallMode::NonBlocking);
        }

        // Последнему отдаём владение без копирования.
        let data = EmitData {
            event: event.to_string(),
            payload: payload_json,
            binary: binary.map(Buffer::from),
        };
        let _ = last.call(data, ThreadsafeFunctionCallMode::NonBlocking);
    }

    /// Сериализует значение в JSON и вызывает его как событие.
    ///
    /// Если сериализация провалилась — отправляем строку `"null"`, чтобы
    /// JS-сторона получила что-то осмысленное, а не мусор.
    pub fn emit_json<T: serde::Serialize>(&self, event: &str, payload: T) {
        let s = serde_json::to_string(&payload).unwrap_or_else(|_| "null".into());
        self.emit(event, Some(s), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Message {
        Message::Text(s.to_string().into())
    }

    fn as_text(msg: &Message) -> String {
        match msg {
            Message::Text(t) => t.to_string(),
            other => panic!("expected text message, got {other:?}"),
        }
    }

    #[test]
    // До подключения сообщения копятся в буфере, а не теряются.
    fn buffers_messages_before_connect() {
        let inner = Inner::new();
        inner.enqueue_or_send(text("a"));
        inner.enqueue_or_send(text("b"));

        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert_eq!(queue.len(), 2),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    // При подключении накопленное переливается в канал в исходном порядке
    // (FIFO), и последующая отправка идёт уже напрямую в канал.
    fn mark_connected_flushes_buffered_messages_in_order() {
        let inner = Inner::new();
        inner.enqueue_or_send(text("first"));
        inner.enqueue_or_send(text("second"));

        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        // Это сообщение должно уйти в канал сразу, без буферизации.
        inner.enqueue_or_send(text("third"));

        let received: Vec<Message> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert_eq!(received.len(), 3);
        assert_eq!(as_text(&received[0]), "first");
        assert_eq!(as_text(&received[1]), "second");
        assert_eq!(as_text(&received[2]), "third");
    }

    #[test]
    // После отключения объект возвращается в состояние буферизации,
    // а старый канал закрывается — `rx.try_recv` видит завершение.
    fn mark_disconnected_returns_to_buffering_and_closes_old_channel() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        let old_tx = inner.mark_disconnected();
        assert!(old_tx.is_some());
        drop(old_tx);

        // Канал закрыт: читатель видит, что новых сообщений не будет.
        assert!(rx.try_recv().is_err());

        // Новые сообщения снова копятся в буфере.
        inner.enqueue_or_send(text("after reconnect"));
        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert_eq!(queue.len(), 1),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    // `send_if_connected` не копит: пока соединения нет, сообщение
    // просто исчезает — это осознанное поведение для heartbeat.
    fn send_if_connected_drops_silently_when_buffering() {
        let inner = Inner::new();
        inner.send_if_connected(text("heartbeat"));

        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => assert!(queue.is_empty()),
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }

    #[test]
    // При активном соединении `send_if_connected` перекладывает сообщение
    // в канал — как обычный `enqueue_or_send`.
    fn send_if_connected_forwards_when_connected() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        inner.mark_connected(tx);

        inner.send_if_connected(text("hb"));
        let received = rx.try_recv().expect("message should be forwarded");
        assert_eq!(as_text(&received), "hb");
    }

    #[test]
    // Буфер буферизации ограничен: сколько бы сообщений ни положили,
    // в очереди их не больше `MAX_PENDING_MESSAGES`.
    fn buffering_is_bounded() {
        let inner = Inner::new();
        for i in 0..(MAX_PENDING_MESSAGES * 2) {
            inner.enqueue_or_send(text(&i.to_string()));
        }

        match &*inner.sink.lock() {
            PacketSink::Buffering(queue) => {
                // После переполнения размер очереди не превышает лимит.
                assert!(
                    queue.len() <= MAX_PENDING_MESSAGES,
                    "queue len {} exceeds limit {}",
                    queue.len(),
                    MAX_PENDING_MESSAGES,
                );
            }
            PacketSink::Connected(_) => panic!("expected buffering state"),
        }
    }
}