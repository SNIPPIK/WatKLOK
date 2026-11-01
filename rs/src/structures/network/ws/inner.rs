use crate::{
    structures::network::ws::opcodes::ws_codes,
    utils::duration::mono_ms
};
use {
    std::sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, AtomicU8, Ordering},
        Arc
    },
    tokio::{
        task::JoinHandle,
        sync::{mpsc, oneshot}
    },
    tokio_tungstenite::tungstenite::Message,
    serde_json::{json, Value},
    parking_lot::Mutex
};

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

/// Сколько соединение должно прожить, чтобы считаться стабильным.
///
/// Соединение, умершее раньше, увеличивает `fail_streak` (от него зависит
/// задержка перед следующей попыткой, см. `connection::backoff_delay`).
/// Прожившее дольше — обнуляет серию: после долгой нормальной работы
/// переподключаемся сразу, без задержки.
const STABLE_AFTER_MS: u64 = 10_000;

/// Потолок счётчика серии неудач (дальше задержка всё равно упирается в максимум).
const MAX_FAIL_STREAK: u32 = 16;

/// Событие WebSocket для Rust-подписчика (`voice::Transport`).
///
/// `event` — имя события (`open`, `close`, `ready`, `sessionDescription`,
/// `error`, `Users`, `daveSession`, `binary`, `info`, ...);
/// `payload` — разобранный JSON; `binary` — бинарные данные, если событие их несёт.
#[derive(Debug, Clone)]
pub struct WsEvent {
    /// Имя события.
    pub event: String,

    /// JSON payload, если событие текстовое. Передаётся как `Value`: так
    /// сообщение не сериализуется в строку и не парсится заново подписчиком.
    pub payload: Option<Value>,

    /// Бинарные данные, если событие бинарное.
    pub binary: Option<Vec<u8>>
}

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
    Connected(mpsc::UnboundedSender<Message>)
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

    /// Подписчик на все события (см. `VoiceWebSocket::subscribe_native`).
    /// Без подписчика события отбрасываются.
    pub native_tx: Mutex<Option<mpsc::UnboundedSender<WsEvent>>>,

    /// Поколение соединения. Увеличивается в `invalidate()` (reset/destroy)
    /// и `begin_connection()` (новый connect). Задачи соединения и heartbeat
    /// запоминают «своё» поколение и перестают трогать общее состояние, как
    /// только оно устарело: `abort()` срабатывает только на ближайшем `await`,
    /// и без этой проверки старая задача успевала бы затереть состояние нового
    /// соединения (статус, sink, heartbeat).
    pub generation: AtomicU64,

    /// `true`, если для текущего поколения событие `close` уже отправлено.
    /// Гарантирует ровно один `close` на соединение: дубль (например,
    /// heartbeat-timeout + следом реальный обрыв) увеличивал бы счётчик
    /// попыток в транспорте дважды и приближал бы его к `destroy()`.
    close_emitted: AtomicBool,

    /// Сколько подряд соединений не удалось поднять или они умерли раньше
    /// `STABLE_AFTER_MS`. Переживает `reset()`/`connect()`, поэтому именно
    /// по нему считается пауза перед повторной попыткой.
    pub fail_streak: AtomicU32,

    /// Время (`mono_ms`) открытия текущего соединения. `0` — не открыто.
    opened_at_ms: AtomicU64,

    /// Время (`mono_ms`) последнего принятого кадра любого типа.
    /// Heartbeat использует его, чтобы не считать соединение мёртвым,
    /// если ACK задержался, а остальной трафик идёт.
    pub last_rx_ms: AtomicU64,

    /// Канал для остановки задачи соединения изнутри (heartbeat-timeout,
    /// ошибка записи). `oneshot`, а не `Notify`: сигнал не теряется, если
    /// задача в момент отправки занята обработкой кадра.
    kill_tx: Mutex<Option<oneshot::Sender<()>>>
}

impl Inner {
    /// Создаёт состояние в исходном виде: соединения нет, буфер пуст.
    /// Возвращает `Arc`, потому что объект живёт в нескольких задачах.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sink: Mutex::new(PacketSink::Buffering(Vec::new())),
            sequence: AtomicI64::new(-1),
            status: AtomicU8::new(ws_codes::status::CLOSED),
            ready: AtomicBool::new(false),
            destroyed: AtomicBool::new(false),
            hb_pending: AtomicBool::new(false),
            hb_task: Mutex::new(None),
            conn_task: Mutex::new(None),
            native_tx: Mutex::new(None),
            generation: AtomicU64::new(0),
            close_emitted: AtomicBool::new(false),
            fail_streak: AtomicU32::new(0),
            opened_at_ms: AtomicU64::new(0),
            last_rx_ms: AtomicU64::new(0),
            kill_tx: Mutex::new(None)
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
    ///
    /// Возвращает `false`, если `generation` уже устарело (между рукопожатием
    /// и этим вызовом случился `reset()`/новый `connect()`): тогда ничего
    /// не меняется, а вызывающая задача должна просто завершиться. Проверка
    /// идёт под замком sink'а — `reset()` берёт тот же замок в
    /// `mark_disconnected`, поэтому устаревший канал не «воскреснет».
    pub fn mark_connected(&self, generation: u64, tx: mpsc::UnboundedSender<Message>) -> bool {
        let mut sink = self.sink.lock();
        if !self.is_current(generation) {
            return false;
        }

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
        true
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

    /// То же, что [`Self::mark_disconnected`], но только если соединение
    /// всё ещё «своё»: устаревшая задача не должна выбрасывать канал
    /// нового соединения.
    pub fn mark_disconnected_for(&self, generation: u64) -> Option<mpsc::UnboundedSender<Message>> {
        let mut sink = self.sink.lock();
        if !self.is_current(generation) {
            return None;
        }
        match std::mem::replace(&mut *sink, PacketSink::Buffering(Vec::new())) {
            PacketSink::Connected(tx) => Some(tx),
            PacketSink::Buffering(_) => None
        }
    }

    // ========================================================================
    // Поколения соединений
    // ========================================================================

    /// Объявляет все текущие задачи соединения устаревшими. Вызывается из
    /// `reset()` первым делом — раньше `abort()`, чтобы уже работающая на
    /// другом потоке задача увидела смену поколения.
    pub fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        // Старый sender отбрасываем: приёмник у устаревшей задачи получит
        // `Err` и она выйдет из цикла чтения.
        *self.kill_tx.lock() = None;
    }

    /// Начинает новое поколение для очередного `connect()` и обнуляет
    /// пер-соединительные поля. Возвращает номер поколения для задачи.
    pub fn begin_connection(&self) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.close_emitted.store(false, Ordering::SeqCst);
        self.opened_at_ms.store(0, Ordering::SeqCst);
        self.last_rx_ms.store(0, Ordering::SeqCst);
        *self.kill_tx.lock() = None;
        generation
    }

    /// `true`, если `generation` — актуальное поколение.
    #[inline]
    pub fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    /// Фиксирует момент открытия соединения и регистрирует канал остановки.
    /// `false` — поколение устарело, задаче пора завершиться.
    pub fn mark_opened(&self, generation: u64, kill_tx: oneshot::Sender<()>) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.opened_at_ms.store(mono_ms().max(1), Ordering::SeqCst);
        *self.kill_tx.lock() = Some(kill_tx);
        true
    }

    /// Просит задачу соединения этого поколения остановиться. Для чужого
    /// (устаревшего) поколения — no-op.
    pub fn kill_connection(&self, generation: u64) {
        if !self.is_current(generation) {
            return;
        }
        if let Some(tx) = self.kill_tx.lock().take() {
            let _ = tx.send(());
        }
    }

    /// Единая точка отправки `close`: не более одного раза на соединение,
    /// только от актуального поколения. Заодно обновляет `fail_streak`.
    ///
    /// Пересчёт серии стоит ДО отправки события: транспорт реагирует на
    /// `close` немедленно и сразу вызывает `connect()`, а задача нового
    /// соединения должна увидеть уже обновлённое значение.
    pub fn finish_connection(&self, generation: u64, code: u32, reason: impl Into<String>) {
        if !self.is_current(generation) {
            return;
        }
        if self.close_emitted.swap(true, Ordering::SeqCst) {
            return;
        }

        let opened = self.opened_at_ms.load(Ordering::SeqCst);
        let stable = opened != 0 && mono_ms().saturating_sub(opened) >= STABLE_AFTER_MS;
        if stable {
            self.fail_streak.store(0, Ordering::SeqCst);
        } else {
            let _ = self.fail_streak.try_update(Ordering::SeqCst, Ordering::SeqCst, |s| {
                Some((s + 1).min(MAX_FAIL_STREAK))
            });
        }

        let reason: String = reason.into();
        self.emit_json("close", json!({ "code": code, "reason": reason }));
    }

    // ========================================================================
    // Events
    // ========================================================================

    /// Отправляет событие подписчику (см. `VoiceWebSocket::subscribe_native`).
    ///
    /// Без подписчика событие молча отбрасывается. Канал неограниченный, поэтому
    /// отправка не блокирует ни задачу соединения, ни heartbeat.
    pub fn emit(&self, event: &str, payload: Option<Value>, binary: Option<Vec<u8>>) {
        let native = self.native_tx.lock();
        if let Some(tx) = native.as_ref() {
            let _ = tx.send(WsEvent {
                event: event.to_string(),
                payload,
                binary
            });
        }
    }

    /// Отправляет событие с JSON-значением (без промежуточной строки).
    pub fn emit_json(&self, event: &str, payload: impl Into<Value>) {
        self.emit(event, Some(payload.into()), None);
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
        assert!(inner.mark_connected(0, tx));

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
        assert!(inner.mark_connected(0, tx));

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
        assert!(inner.mark_connected(0, tx));

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

    #[test]
    // `mark_connected` от устаревшего поколения ничего не меняет:
    // старая задача не может «оживить» канал после reset().
    fn mark_connected_rejects_stale_generation() {
        let inner = Inner::new();
        let generation = inner.begin_connection();
        inner.invalidate();

        let (tx, _rx) = mpsc::unbounded_channel();
        assert!(!inner.mark_connected(generation, tx));

        match &*inner.sink.lock() {
            PacketSink::Buffering(_) => {}
            PacketSink::Connected(_) => panic!("stale generation must not connect the sink"),
        }
    }

    #[test]
    // На соединение уходит ровно один `close`, дубли отбрасываются.
    fn finish_connection_emits_close_once() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        *inner.native_tx.lock() = Some(tx);

        let generation = inner.begin_connection();
        inner.finish_connection(generation, 4009, "first");
        inner.finish_connection(generation, 1006, "second");

        let first = rx.try_recv().expect("first close must be delivered");
        assert_eq!(first.event, "close");
        assert!(rx.try_recv().is_err(), "second close must be dropped");
    }

    #[test]
    // Устаревшее поколение не шлёт `close` и не трогает счётчик серии.
    fn finish_connection_ignores_stale_generation() {
        let inner = Inner::new();
        let (tx, mut rx) = mpsc::unbounded_channel();
        *inner.native_tx.lock() = Some(tx);

        let generation = inner.begin_connection();
        inner.invalidate();
        inner.finish_connection(generation, 1006, "stale");

        assert!(rx.try_recv().is_err());
        assert_eq!(inner.fail_streak.load(Ordering::SeqCst), 0);
    }

    #[test]
    // Соединение, не дожившее до порога стабильности, наращивает серию.
    fn short_lived_connection_grows_fail_streak() {
        let inner = Inner::new();
        for expected in 1..=3u32 {
            let generation = inner.begin_connection();
            inner.finish_connection(generation, 1006, "x");
            assert_eq!(inner.fail_streak.load(Ordering::SeqCst), expected);
        }
    }
}