use crate::structures::network::ws::{
    opcodes::{is_dave, discord_opcode, ws_status },
    inner::Inner,
    heartbeat
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{
    tungstenite::{
        client::IntoClientRequest,
        Error as WsError,
        Message
    },
    connect_async
};
use std::sync::{
    atomic::Ordering,
    Arc, OnceLock
};
use tokio::{
    time::{timeout, Duration},
    sync::mpsc
};

/// Тайм-аут на аккуратное закрытие задачи записи.
///
/// После освобождения канала её `rx.recv()` вернёт `None`, цикл завершится,
/// выполнится `sink.close().await` — Discord получит чистый кадр Close.
/// Если за это время задача не завершилась (зависла на вводе-выводе),
/// прерываем её принудительно.
const WRITE_TASK_CLOSE_TIMEOUT: Duration = Duration::from_millis(500);

/// Максимум на установку TCP + TLS + WebSocket-рукопожатия. Без него
/// заблокированный или «чёрная дыра» хост держал бы подключение до
/// системного тайм-аута TCP (минуты).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Однократная инициализация криптографического провайдера.
///
/// `OnceLock` гарантирует, что установка произойдёт ровно один раз,
/// независимо от того, сколько соединений запущено параллельно.
static CRYPTO_INIT: OnceLock<()> = OnceLock::new();

/// Устанавливает криптографический провайдер по умолчанию, если ещё не установлен.
///
/// Ошибку установки игнорируем: если провайдер уже был задан кем-то другим
/// (например, другим модулем или внешним кодом), это не наша проблема —
/// главное, чтобы он был хоть какой-то.
#[inline]
fn ensure_crypto_provider() {
    CRYPTO_INIT.get_or_init(|| {
        // Ошибку игнорируем: если провайдер уже установлен другим параметром,
        // это не считается проблемой.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Основной цикл соединения: устанавливает WebSocket, читает входящие
/// сообщения и передаёт их обработчикам.
///
/// Отправка вынесена в отдельную задачу (см. ниже), потому что чтение
/// из `stream` и запись в `sink` — независимые операции: одна может
/// блокироваться в ожидании данных от сервера, другая — в ожидании
/// данных из канала отправки. Совмещать их в одном цикле значит
/// задерживать одно другим.
pub async fn run(inner: Arc<Inner>, url: String) {
    // Крипто-провайдер должен быть установлен до первого TLS-соединения.
    ensure_crypto_provider();

    // Соединение ещё не установлено, но попытка уже начата.
    inner.status.store(ws_status::CONNECTING, Ordering::SeqCst);

    // Разбираем URL. Ошибка на этом шаге означает, что вызывающий передал
    // мусор — сообщаем наверх через события и выходим.
    let request = match url.as_str().into_client_request() {
        Ok(req) => req,
        Err(e) => {
            // Невалидный URL — вызываем ошибку и close, затем выходим.
            let msg = format!("invalid url: {e}");
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    // Диагностическое сообщение: полезно при отладке проблем с подключением.
    inner.emit_json("info", json!(format!("[WebSocket] connecting to {url}")));

    // Устанавливаем соединение. Ошибка здесь — тоже не паника: сообщаем
    // наверх и выходим, чтобы вызывающий мог решить, что делать.
    let connected = match timeout(CONNECT_TIMEOUT, connect_async(request)).await {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err(format!("connect timeout ({}s)", CONNECT_TIMEOUT.as_secs())),
    };
    let (ws, _) = match connected {
        Ok(v) => v,
        Err(msg) => {
            // Не удалось подключиться — вызываем ошибку и close.
            inner.emit_json("error", json!({ "message": msg.clone() }));
            inner.emit_json("close", json!({ "code": 4006, "reason": msg }));
            inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
            return;
        }
    };

    // Разделяем соединение на две половины: sink для записи, stream для чтения.
    // Каждая половина используется своей задачей и не пересекается с другой.
    let (mut sink, mut stream) = ws.split();

    // С этого момента соединение считается открытым.
    inner.ready.store(true, Ordering::SeqCst);
    inner.status.store(ws_status::OPEN, Ordering::SeqCst);

    // Неограниченный канал: продюсер (наш код и внешние вызовы) не должен
    // блокироваться при отправке. Ограничение здесь бессмысленно: если
    // сеть не успевает, пакеты всё равно накопятся, а блокировать
    // вызывающего — хуже, чем принять их в очередь.
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Публикуем отправителя в общем состоянии: теперь `enqueue_or_send`
    // сможет складывать сообщения в канал, а не в буфер ожидания.
    inner.mark_connected(tx);

    // Уведомляем JS-сторону: соединение установлено.
    inner.emit("open", None, None);
    inner.emit_json("info", json!("[WebSocket] has open connection"));

    // Отдельная задача на отправку: перекладывает сообщения из канала в sink.
    // Живёт до тех пор, пока канал не будет освобождён (rx.recv() == None).
    let mut write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            // Ошибка отправки означает, что соединение разорвано —
            // выходим из цикла, дальше писать некуда.
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        // Закрываем sink при выходе. Даже если соединение уже мертво,
        // close() отправит Close-кадр (или убедится, что он не нужен).
        let _ = sink.close().await;
    });

    // Флаг: был ли уже отправлен `close` — чтобы не отправить его дважды
    // (один раз из ветки Message::Close, второй раз в конце цикла).
    let mut close_emitted = false;

    // Основной цикл чтения. `stream.next()` возвращает None при закрытии
    // потока; Some(Err) — при ошибке протокола или ввода-вывода.
    while let Some(result) = stream.next().await {
        match result {
            // Текстовый кадр — это JSON-сообщение Discord.
            Ok(Message::Text(text)) => handle_text(&inner, text.as_str()),

            // Бинарный кадр — DAVE-протокол (шифрование голоса).
            Ok(Message::Binary(data)) => handle_binary(&inner, &data),

            // Явный ответ на WS-уровневый Ping.
            //
            // tokio-tungstenite при чтении Ping ставит ответный Pong во
            // внутреннюю очередь (additional_send), но она сбрасывается
            // только при следующей записи в sink. Если наш write_task
            // спит на `rx.recv().await` (тихий канал, нет исходящих
            // сообщений), Pong никогда не уходит, и Discord через ~30 с
            // разрывает соединение.
            //
            // `enqueue_or_send` кладёт Pong в наш канал — write_task его
            // отправит и заодно освободит additional_send. Дублирующий
            // Pong (наш плюс автоматически поставленный в очередь) безвреден.
            Ok(Message::Ping(payload)) => {
                inner.enqueue_or_send(Message::Pong(payload));
            }

            // Сервер прислал кадр Close. Извлекаем код и причину, сообщаем
            // наверх и выходим из цикла — соединение закрыто.
            Ok(Message::Close(frame)) => {
                let (code, reason) = match frame {
                    Some(f) => (u16::from(f.code) as u32, f.reason.to_string()),
                    None => (1000, String::new()),
                };
                inner.emit_json("close", json!({ "code": code, "reason": reason }));
                close_emitted = true;
                break;
            }

            // Pong и прочие служебные кадры — игнорируем: реакции не требуют.
            Ok(_) => {}

            // Ошибка чтения. Различаем два случая:
            // * протокольная/сетевая/закрытие соединения — это нормальный
            //   ход событий, логируем как info;
            // * всё остальное — неожиданно, логируем как error.
            Err(e) => {
                let abnormal = matches!(e, WsError::Protocol(_) | WsError::Io(_) | WsError::ConnectionClosed);

                // Если событие является не нормальным
                if abnormal {
                    inner.emit_json("info", json!(format!("[WebSocket] connection lost: {e}")));
                } else {
                    inner.emit_json("error", json!({ "message": e.to_string() }));
                }
                break;
            }
        }
    }

    // Если сервер не прислал кадр Close, а поток просто оборвался —
    // сообщаем наверх как "аварийное закрытие" с кодом 1006.
    if !close_emitted {
        inner.emit_json(
            "close",
            json!({
                "code": 1006u32,
                "reason": "Abnormal closure (connection reset or stream ended without close frame)"
            }),
        );
    }

    // Переводим состояние в "закрывается", затем в "закрыто".
    inner.status.store(ws_status::CLOSING, Ordering::SeqCst);
    inner.ready.store(false, Ordering::SeqCst);

    // Возвращаем sink в состояние буферизации и освобождаем прежний канал —
    // это разбудит задачу записи (rx.recv() вернёт None).
    let _ = inner.mark_disconnected();

    // Аккуратное закрытие вместо мгновенного прерывания.
    //
    // После освобождения tx (внутри mark_disconnected) rx.recv() вернёт None,
    // цикл завершится, и выполнится `sink.close().await` — Discord получит
    // чистый кадр Close. Раньше прерывание убивало задачу до того, как
    // она успевала дойти до sink.close().
    //
    // Если за WRITE_TASK_CLOSE_TIMEOUT задача не завершилась (зависла
    // на вводе-выводе, peer не отвечает), прерываем принудительно,
    // чтобы не подвешивать завершение соединения.
    if timeout(WRITE_TASK_CLOSE_TIMEOUT, &mut write_task).await.is_err() {
        write_task.abort();
        let _ = write_task.await;
    }

    // Останавливаем heartbeat: соединение закрыто, пульс больше не нужен.
    heartbeat::stop(&inner);

    // Финальное состояние — "закрыто". Снаружи это видно через `socket.status`.
    inner.status.store(ws_status::CLOSED, Ordering::SeqCst);
}

/// Обрабатывает текстовый кадр: разбирает JSON и вызывает соответствующее
/// событие на JS-стороне в зависимости от поля `op`.
fn handle_text(inner: &Arc<Inner>, text: &str) {
    // Парсим JSON. Битая строка — сообщаем наверх и выходим: без разбора
    // всё равно ничего не сделать.
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            inner.emit_json("error", json!("Invalid JSON"));
            return;
        }
    };

    // А seq (если есть) сохраняем: он нужен для Resume при переподключении.
    // Сохраняем ДО разбора `op`, потому что seq может прийти в любом пакете.
    if let Some(seq) = payload.get("seq").and_then(|v| v.as_i64()) {
        inner.sequence.store(seq, Ordering::SeqCst);
    }

    // Извлекаем код операции. Если его нет — разбирать нечего.
    let Some(op_code) = payload.get("op").and_then(|v| v.as_u64()) else {
        return;
    };
    let op_code = op_code;

    // Диспетчеризация по коду операции: каждому — своё событие наружу.
    match op_code {
        // Пульс подтверждён — сбрасываем ожидание в heartbeat.
        discord_opcode::HEARTBEAT_ACK => heartbeat::ack(inner),

        // Сервер представился: содержит интервал пульса. Запускаем heartbeat.
        discord_opcode::HELLO => {
            if let Some(interval) = payload
                .get("d")
                .and_then(|d| d.get("heartbeat_interval"))
                .and_then(|v| v.as_u64())
            {
                // heartbeat::start сам ограничивает интервал разумными
                // рамками, здесь дополнительная проверка не нужна.
                heartbeat::start(inner.clone(), interval);
            }
        }

        // Кто-то начал или закончил говорить. Полезно для индикации в UI.
        discord_opcode::SPEAKING => inner.emit_json("speaking", payload),

        // Кто-то подключился к голосовому каналу или отключился.
        discord_opcode::CLIENTS_CONNECT | discord_opcode::CLIENT_DISCONNECT => inner.emit_json("Users", payload),

        // Соединение готово к работе: содержит SSRC, порты, режимы шифрования.
        discord_opcode::READY => inner.emit_json("ready", payload),

        // Описание сессии: ключ шифрования для голоса.
        discord_opcode::SESSION_DESCRIPTION => inner.emit_json("sessionDescription", payload),

        // Сессия успешно восстановлена после переподключения.
        discord_opcode::RESUMED => inner.emit_json("resumed", payload),

        // DAVE-протокол (новый механизм шифрования голоса Discord).
        _ if is_dave(op_code) => inner.emit_json("daveSession", payload),

        // Неизвестные операции молча игнорируем: протокол может
        // добавлять новые коды, и падать из-за них не нужно.
        _ => {}
    }
}

/// Обрабатывает бинарный кадр: разбирает заголовок DAVE-протокола
/// и передаёт его наверх вместе с телом.
fn handle_binary(inner: &Arc<Inner>, data: &[u8]) {
    // Минимальный размер — 3 байта заголовка (seq: u16, op: u8).
    // Всё, что короче, — повреждённый кадр, игнорируем.
    if data.len() < 3 {
        return;
    }

    // Заголовок DAVE: sequence (2 байта, big-endian) + opcode (1 байт).
    let sequence = u16::from_be_bytes([data[0], data[1]]);
    let op_code = data[2];
    let payload = &data[3..];

    // Если sequence не нулевой — обновляем общий счётчик.
    // Нулевой sequence в DAVE означает "без номера", его сохранять не нужно.
    if sequence != 0 {
        inner.sequence.store(sequence as i64, Ordering::SeqCst);
    }

    // Передаём наверх как событие "binary" с op в виде JSON-строки
    // и бинарным payload'ом. Разбирать DAVE на этом уровне смысла нет —
    // это задача JS-стороны.
    inner.emit(
        "binary",
        Some(json!({ "op": op_code })),
        Some(payload.to_vec()),
    );
}