pub mod connection;
pub mod heartbeat;
pub mod inner;
pub mod opcodes;
pub mod runtime;

use napi::{
    threadsafe_function::ThreadsafeCallContext,
    bindgen_prelude::*
};
use napi_derive::napi;
use std::sync::{
    atomic::Ordering,
    Arc
};
use tokio_tungstenite::tungstenite::Message;
use crate::structures::network::ws::{
    inner::{EmitData, EventFn, Inner},
    opcodes::ws_status
};

/// Обёртка Voice WebSocket для JavaScript.
///
/// Управляет подключением к Discord Voice Gateway, отправкой и приёмом
/// сообщений и отправкой событий в JS через потокобезопасные функции.
/// Вся работа с сетью и таймерами выполняется в Tokio-runtime, JS-сторона
/// получает только события и управляет жизненным циклом.
#[napi]
pub struct VoiceWebSocket {
    /// Разделяемое внутреннее состояние (сокет, очередь, флаги, события).
    /// Обёрнуто в `Arc`, потому что используется и из JS-обёртки, и из
    /// задач Tokio-runtime, живущих параллельно.
    inner: Arc<Inner>
}

#[napi]
impl VoiceWebSocket {
    /// Создаёт объект без активного подключения.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { inner: Inner::new() }
    }

    /// `true`, если WebSocket-соединение активно.
    /// Геттер, читается напрямую из JS как `socket.ready`.
    #[napi(getter)]
    pub fn ready(&self) -> bool {
        self.inner.ready.load(Ordering::SeqCst)
    }

    /// Текущий статус соединения (код из `ws_status`).
    /// Приводится к `u32`, потому что JS не знает про Rust-овские enum'ы.
    #[napi(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status.load(Ordering::SeqCst) as u32
    }

    /// Последний полученный seq от Discord (для Resume).
    /// `-1` означает "seq ещё не получен".
    #[napi(getter)]
    pub fn sequence(&self) -> i64 {
        self.inner.sequence.load(Ordering::SeqCst)
    }

    /// Регистрирует обработчик JS-события.
    ///
    /// Внутри создаётся потокобезопасная функция, которая при срабатывании
    /// преобразует `EmitData` в набор JSON-значений и передаёт их
    /// JS-функции как позиционные аргументы.
    ///
    /// Формат аргументов зависит от имени события:
    /// * `open` | `resumed` | `disconnect` — без аргументов;
    /// * `info` — строка;
    /// * `error` — объект `{ message, stack }`;
    /// * `close` — `(code: number, reason: string)`;
    /// * `binary` — `{ op, payload: number[] }`;
    /// * прочие события — разобранным JSON-payload.
    ///
    /// # Аргументы
    /// * `event` — имя события.
    /// * `callback` — JS-функция-обработчик.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если не удалось построить потокобезопасную функцию.
    #[napi]
    pub fn on(&self, event: String, callback: Function<(), ()>) -> Result<()> {
        // Имя события нужно внутри callback — клонируем заранее,
        // потому что `event` уйдёт в мапу в конце, а callback должен
        // располагать своим экземпляром строки.
        let event_name = event.clone();

        // Потокобезопасная функция: при вызове она может быть выполнена
        // в JS-потоке, а не в том, где регистрировалась.
        let js_fn: EventFn = callback
            .build_threadsafe_function()
            .build_callback(move |ctx: ThreadsafeCallContext<EmitData>| {
                // `ctx.value` — то, что прилетело из Rust-стороны через
                // `call(...)`. Разбираем в зависимости от имени события.
                let data = ctx.value;

                // Набор аргументов формируется как Vec<serde_json::Value>,
                // каждый элемент — отдельный аргумент JS-функции.
                // serde_json::Value здесь используется как "универсальная
                // оболочка": napi сам конвертирует их в JS-значения.
                //
                // `_null` — заготовка на будущее (сейчас не используется,
                // но оставлена как образец для пустого значения).
                let _null = || serde_json::Value::Null;
                let args: Vec<serde_json::Value> = match event_name.as_str() {
                    // Без аргументов.
                    "open" | "resumed" => vec![],

                    // Одна строка — текстовая информация от соединения.
                    "info" => vec![serde_json::Value::String(data.payload.unwrap_or_default())],

                    // Объект с полями message/stack.
                    "error" => {
                        // payload — JSON-строка, парсим её. Если строка
                        // битая или отсутствует — Null, чтобы не упасть.
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        // Подставляем значения по умолчанию, если поля
                        // отсутствуют: пустой message и stack = message,
                        // чтобы у JS всегда было что показать.
                        let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown WebSocket error");
                        let stack   = parsed.get("stack").and_then(|v| v.as_str()).unwrap_or(message);

                        // Собираем новый объект только из нужных полей —
                        // наружу не утекает лишнее из payload.
                        let mut obj = serde_json::Map::new();
                        obj.insert("message".into(), serde_json::Value::String(message.into()));
                        obj.insert("stack".into(),   serde_json::Value::String(stack.into()));
                        vec![serde_json::Value::Object(obj)]
                    }

                    // Два аргумента: код и причина.
                    // Ветка `disconnect` обрабатывается так же, как `close` —
                    // у них одинаковый набор полей, отличаться может только
                    // причина.
                    "close" | "disconnect" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);

                        // 1006 (abnormal closure) — стандартный код, который
                        // имеет смысл подставлять, если своего не пришло.
                        let code = parsed.get("code").and_then(|v| v.as_u64()).unwrap_or(1006);
                        let reason = parsed.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string();

                        vec![
                            serde_json::Value::Number(code.into()),
                            serde_json::Value::String(reason),
                        ]
                    }

                    // Объект { op, payload: number[] }.
                    "binary" => {
                        let parsed: serde_json::Value = serde_json::from_str(
                            data.payload.as_deref().unwrap_or("null"),
                        ).unwrap_or(serde_json::Value::Null);
                        let op = parsed.get("op").and_then(|v| v.as_u64()).unwrap_or(0);

                        let mut obj = serde_json::Map::new();
                        obj.insert("op".into(), serde_json::Value::Number(op.into()));

                        // Бинарные данные передаются как массив байтов:
                        // другого способа отдать их в JS через serde_json
                        // нет, а `Buffer` тащить ради одного поля не хочется.
                        if let Some(buf) = data.binary {
                            let arr: Vec<serde_json::Value> = buf.iter()
                                .map(|b| serde_json::Value::Number((*b).into()))
                                .collect();
                            obj.insert("payload".into(), serde_json::Value::Array(arr));
                        }
                        vec![serde_json::Value::Object(obj)]
                    }

                    // Универсальная ветка: весь JSON-payload как единственный
                    // аргумент. Используется для Discord-событий вроде
                    // `session_description`, `hello` и т.п., где структура
                    // известна вызывающему JS-коду.
                    _ => {
                        let s = data.payload.unwrap_or_else(|| "null".to_string());
                        let parsed: serde_json::Value = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                        vec![parsed]
                    }
                };

                Ok(args)
            })?;

        // Регистрируем обработчик в списке событий.
        // Ключ — имя события, значение — вектор функций: можно повесить
        // несколько обработчиков на одно событие, они вызовутся все.
        // `Arc` нужен, потому что функции дёргаются из Tokio-задач,
        // живущих параллельно с JS-стороной.
        self.inner
            .events
            .lock()
            .entry(event)
            .or_default()
            .push(Arc::new(js_fn));
        Ok(())
    }

    /// Отправляет пакет в WebSocket.
    ///
    /// Если соединение ещё не готово, пакет помещается в буфер и будет
    /// отправлен после установления соединения (см. `Inner::enqueue_or_send`).
    ///
    /// # Ошибки
    /// Возвращает ошибку, если объект уже уничтожен через `destroy()`.
    //
    // У этой функции два имени в JS: `set_packet` (Rust-метод) и `packet`
    // (JS-сеттер). Так сделано потому, что JS-стороне удобнее писать
    // `socket.packet = data`, а не звать метод.
    #[napi(js_name = "packet", setter)]
    pub fn send_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        // Отсечка на уничтоженный объект: отправлять в него нечего, и
        // молча терять пакет нельзя — вызывающий должен знать об ошибке.
        if self.inner.destroyed.load(Ordering::SeqCst) {
            return Err(Error::from_reason(
                "VoiceWebSocket has been destroyed and cannot send packets",
            ));
        }

        // JS присылает либо Buffer (бинарные данные), либо строку (JSON).
        // Соответственно превращаем в один из вариантов tungstenite.
        let msg = match payload {
            Either::A(buf) => Message::Binary(buf.to_vec().into()),
            Either::B(s) => Message::Text(s.into()),
        };

        // Дальше решает Inner: если соединение готово — отправляет сразу,
        // если нет — копит в очереди до установления соединения.
        self.inner.enqueue_or_send(msg);
        Ok(())
    }

    /// Открывает WebSocket-подключение к указанному endpoint'у.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если объект уже уничтожен через `destroy()` —
    /// ранее это не проверялось, что позволяло оживить уничтоженный
    /// объект и получить неработающие события (таблица обработчиков уже
    /// очищена в `destroy()`).
    #[napi]
    pub fn connect(&self, endpoint: String, _code: Option<u32>) -> Result<()> {
        // Уничтоженный объект не должен принимать новые соединения.
        if self.inner.destroyed.load(Ordering::SeqCst) {
            return Err(Error::from_reason(
                "VoiceWebSocket has been destroyed and cannot be reused",
            ));
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
        // зависеть от времени жизни JS-обёртки.
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
    #[napi]
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
    /// после вызова невозможно (`connect`/`packet` вернут ошибку).
    #[napi]
    pub fn destroy(&self) {
        // Освобождаем соединение и все связанные ресурсы.
        self.reset();

        // Помечаем объект как уничтоженный — все публичные методы
        // проверяют этот флаг и отказываются работать.
        self.inner.destroyed.store(true, Ordering::SeqCst);

        // Убираем зарегистрированные JS-обработчики: после уничтожения
        // события всё равно не придут, а держать функции (и их замыкания,
        // и ссылки на JS-объекты) нет смысла — это утечка.
        self.inner.events.lock().clear();

        // Сбрасываем последний полученный seq в "не получен".
        // -1 — маркер "seq отсутствует", тот же, что в initial-состоянии.
        self.inner.sequence.store(-1, Ordering::SeqCst);
    }

    /// Синоним для `send_packet`.
    /// Существует для JS-стороны: `socket.set_packet(data)` читается
    /// лучше, чем `socket.send_packet(data)`, и совпадает по имени
    /// с ключом в сериализации на другом конце.
    #[napi]
    pub fn set_packet(&self, payload: Either<Buffer, String>) -> Result<()> {
        self.send_packet(payload)
    }
}