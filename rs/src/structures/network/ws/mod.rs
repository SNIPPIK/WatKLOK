use tokio_tungstenite::tungstenite::Message;
use crate::structures::network::ws::{
    inner::{Inner, WsEvent},
    opcodes::ws_status
};
use tokio::sync::mpsc;
use std::sync::{
    atomic::Ordering,
    Arc
};

/// Voice WebSocket Discord (чистый Rust, без napi).
///
/// Управляет подключением к Discord Voice Gateway, отправкой и приёмом
/// сообщений. События приходят подписчику через `subscribe_native`.
/// Вся работа с сетью и таймерами выполняется в Tokio-runtime.
pub struct VoiceWebSocket {
    /// Разделяемое внутреннее состояние (сокет, очередь, флаги, события).
    /// Обёрнуто в `Arc`, потому что используется и из этого объекта, и из
    /// задач Tokio-runtime, живущих параллельно.
    inner: Arc<Inner>
}

impl VoiceWebSocket {
    /// Создаёт объект без активного подключения.
    pub fn new() -> Self {
        Self { inner: Inner::new() }
    }

    /// `true`, если WebSocket-соединение активно.
    pub fn ready(&self) -> bool {
        self.inner.ready.load(Ordering::SeqCst)
    }

    /// Текущий статус соединения (код из `ws_status`).
    pub fn status(&self) -> u32 {
        self.inner.status.load(Ordering::SeqCst) as u32
    }

    /// Последний полученный seq от Discord (для Resume).
    /// `-1` означает "seq ещё не получен".
    pub fn sequence(&self) -> i64 {
        self.inner.sequence.load(Ordering::SeqCst)
    }

    /// Отправляет текстовый пакет (JSON) в WebSocket.
    ///
    /// Если соединение ещё не готово, пакет помещается в буфер и будет
    /// отправлен после установления соединения (см. `Inner::enqueue_or_send`).
    ///
    /// # Ошибки
    /// Возвращает ошибку, если объект уже уничтожен через `destroy()`.
    pub fn send_text(&self, text: String) -> Result<(), String> {
        self.send_message(Message::Text(text.into()))
    }

    /// Отправляет бинарный пакет в WebSocket (DAVE).
    ///
    /// Поведение и ошибки — как у [`Self::send_text`].
    pub fn send_binary(&self, data: Vec<u8>) -> Result<(), String> {
        self.send_message(Message::Binary(data.into()))
    }

    fn send_message(&self, msg: Message) -> Result<(), String> {
        // Отсечка на уничтоженный объект: отправлять в него нечего, и
        // молча терять пакет нельзя — вызывающий должен знать об ошибке.
        if self.inner.destroyed.load(Ordering::SeqCst) {
            return Err("VoiceWebSocket has been destroyed and cannot send packets".to_string());
        }

        // Дальше решает Inner: если соединение готово — отправляет сразу,
        // если нет — копит в очереди до установления соединения.
        self.inner.enqueue_or_send(msg);
        Ok(())
    }

    /// Открывает WebSocket-подключение к указанному endpoint'у.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если объект уже уничтожен через `destroy()`:
    /// иначе можно было бы оживить уничтоженный объект без подписчика.
    pub fn connect(&self, endpoint: String) -> Result<(), String> {
        // Уничтоженный объект не должен принимать новые соединения.
        if self.inner.destroyed.load(Ordering::SeqCst) {
            return Err("VoiceWebSocket has been destroyed and cannot be reused".to_string());
        }

        // Сбрасываем предыдущее соединение (если было), чтобы не оставить
        // висящих задач, heartbeat'ов и неиспользуемых каналов.
        self.reset();

        // Нормализация endpoint: убираем схему и ведущий "/".
        // Discord отдаёт endpoint и как "wss://host", и как "host/",
        // и как "host" — приводим к единому виду.
        let host = endpoint
            .trim_start_matches("wss://")
            .trim_start_matches("ws://")
            .trim_start_matches('/');

        // Discord ждёт "/?v=8" — со слешем перед query.
        let url = format!("wss://{host}/?v=8");

        // Клон Arc'а: задача получит свою долю владения и не будет
        // зависеть от времени жизни этого объекта.
        let inner = self.inner.clone();

        // Канал отправки теперь создаётся внутри `connection::run`, сразу
        // после успешного установления соединения (см. изменения
        // в connection.rs/inner.rs).
        //
        // Runtime-хэндл сохраняем, чтобы уметь прервать задачу в reset().
        let handle = runtime::spawn(async move {
            connection::run(inner, url).await;
        });
        *self.inner.conn_task.lock() = Some(handle);
        Ok(())
    }

    /// Сбрасывает текущее соединение и очищает ресурсы.
    ///
    /// Прерывает задачу runtime'а, останавливает heartbeat, закрывает канал
    /// отправки, очищает очередь и приводит флаги к состоянию "отключено".
    /// Безопасен для повторного вызова.
    pub fn reset(&self) {
        // Прерываем текущую задачу соединения, если она запущена.
        // abort() не дожидается завершения — просто ставит метку; следующая
        // проверка await'а в задаче завершит её.
        if let Some(t) = self.inner.conn_task.lock().take() {
            t.abort();
        }

        // Останавливаем heartbeat отдельно: он живёт в своей задаче
        // и не привязан к основной задаче соединения.
        heartbeat::stop(&self.inner);

        // Возвращаем sink в состояние буферизации, освобождая прежний канал
        // (если был) — это закроет rx у задачи записи, если она ещё жива.
        // `let _ =` — ошибка тут не критична: если канал уже сломан,
        // значит задача записи давно завершилась сама.
        let _ = self.inner.mark_disconnected();

        // Приводим флаги к исходному состоянию, чтобы снаружи объект
        // выглядел как "только что созданный, но не подключённый".
        self.inner.ready.store(false, Ordering::SeqCst);
        self.inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
        self.inner.hb_pending.store(false, Ordering::SeqCst);
    }

    /// Полностью уничтожает объект WebSocket. Повторное использование
    /// после вызова невозможно (`connect`/`send_*` вернут ошибку).
    pub fn destroy(&self) {
        // Освобождаем соединение и все связанные ресурсы.
        self.reset();

        // Помечаем объект как уничтоженный — все публичные методы
        // проверяют этот флаг и отказываются работать.
        self.inner.destroyed.store(true, Ordering::SeqCst);

        // Подписчика отпускаем: его приёмник получит `None` и завершится.
        *self.inner.native_tx.lock() = None;

        // Сбрасываем последний полученный seq в "не получен".
        // -1 — маркер "seq отсутствует", тот же, что в initial-состоянии.
        self.inner.sequence.store(-1, Ordering::SeqCst);
    }
}

/// Подписка на события.
impl VoiceWebSocket {
    /// Подписывает Rust-код на все события сокета.
    ///
    /// События приходят в порядке возникновения. Повторный вызов заменяет
    /// предыдущего подписчика.
    pub fn subscribe_native(&self) -> mpsc::UnboundedReceiver<WsEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        *self.inner.native_tx.lock() = Some(tx);
        rx
    }
}

impl Drop for VoiceWebSocket {
    /// Задачи подключения и heartbeat держат `Arc<Inner>`, поэтому без явной
    /// остановки они жили бы после потери владельца (утечка сокета и задач).
    fn drop(&mut self) {
        self.destroy();
    }
}

impl Default for VoiceWebSocket {
    fn default() -> Self {
        Self::new()
    }
}

pub mod connection;
pub mod heartbeat;
pub mod inner;
pub mod opcodes;
pub mod runtime;