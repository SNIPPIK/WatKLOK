use crate::{
    discord::opcodes::discord_opcode,
    utils::duration::mono_ms,
    structures::network::ws::{
        opcodes::{is_dave, ws_codes },
        inner::Inner,
        heartbeat
    }
};
use {
    futures_util::{SinkExt, StreamExt},
    serde_json::{json, Value},
    tokio_tungstenite::{
        tungstenite::{
            client::IntoClientRequest,
            Error as WsError,
            Message
        },
        connect_async
    },
    std::{
        sync::{atomic::Ordering, Arc, OnceLock},
        time::{SystemTime, UNIX_EPOCH}
    },
    tokio::{
        time::{sleep, timeout, Duration},
        sync::{mpsc, oneshot}
    }
};

/// Тайм-аут на аккуратное закрытие задачи записи.
///
/// После освобождения канала её `rx.recv()` вернёт `None`, цикл завершится,
/// выполнится `sink.close().await` — Discord получит чистый кадр Close.
/// Если за это время задача не завершилась (зависла на вводе-выводе),
/// прерываем её принудительно.
const WRITE_TASK_CLOSE_TIMEOUT: Duration = Duration::from_millis(500);

/// Максимум на отправку одного кадра. Без него «мёртвый» сокет (TCP-буфер
/// переполнен, peer пропал) подвешивал бы задачу записи надолго — а после
/// `reset()` такая задача остаётся без владельца и держала бы сокет.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// Максимум на отправку Close-кадра при завершении задачи записи.
const WRITE_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// Параметры паузы перед повторным подключением (экспоненциальная, с джиттером).
///
/// Транспорт переподключается мгновенно, а при рестарте голосового сервера
/// Discord первые попытки обычно падают: две быстрые неудачи подряд и
/// транспорт сдаётся (`MAX_RECONNECTS`). Короткая нарастающая пауза даёт
/// серверу время подняться. Пауза применяется только при серии неудач
/// (`Inner::fail_streak`): после стабильного соединения — без задержки.
///
/// Бюджет по времени: пауза (≤ `BACKOFF_MAX_MS`) + `CONNECT_TIMEOUT` (10 с)
/// остаётся меньше `HANDSHAKE_STAGE_TIMEOUT` транспорта (15 с) на `ws-connect`.
const BACKOFF_BASE_MS: u64 = 500;
const BACKOFF_MAX_MS: u64 = 3_000;

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

/// Пауза перед очередной попыткой по длине серии неудач.
///
/// `0` — без паузы; дальше 0.5 с, 1 с, 2 с, 3 с (потолок), ±20 % джиттера,
/// чтобы множество сессий после общего сбоя не ломились на сервер синхронно.
pub(crate) fn backoff_delay(streak: u32) -> Duration {
    if streak == 0 {
        return Duration::ZERO;
    }

    let base = BACKOFF_BASE_MS
        .saturating_mul(1u64 << (streak - 1).min(4))
        .min(BACKOFF_MAX_MS);

    // Криптостойкость не нужна — хватает младших разрядов системного времени.
    let noise = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);

    let spread = base / 5;
    let jittered = base - spread + noise % (spread * 2 + 1);
    Duration::from_millis(jittered.min(BACKOFF_MAX_MS))
}

/// Сообщает о неудаче установки соединения: опционально `error`, затем
/// `close` (код 4006, как и раньше) и статус `CLOSED`.
///
/// `report_error = false` для временных сетевых сбоев (таймаут, обрыв I/O):
/// `error` транспорт трактует как фатальную ошибку протокола и сразу
/// отдаёт наверх `Close(BAD_REQUEST)`, а обычный `close` ведёт по пути
/// переподключения.
fn fail_connect(inner: &Arc<Inner>, generation: u64, msg: String, report_error: bool) {
    if !inner.is_current(generation) {
        return;
    }
    if report_error {
        inner.emit_json("error", json!({ "message": msg.clone() }));
    }
    inner.finish_connection(generation, 4006, msg);
    inner.status.store(ws_codes::status::CLOSED, Ordering::SeqCst);
}

/// Основной цикл соединения: устанавливает WebSocket, читает входящие
/// сообщения и передаёт их обработчикам.
///
/// `generation` — поколение, выданное `Inner::begin_connection()`. Как только
/// оно устарело (reset/новый connect), задача выходит и не трогает общее
/// состояние: им уже владеет следующее соединение.
///
/// Отправка вынесена в отдельную задачу (см. ниже), потому что чтение
/// из `stream` и запись в `sink` — независимые операции: одна может
/// блокироваться в ожидании данных от сервера, другая — в ожидании
/// данных из канала отправки. Совмещать их в одном цикле значит
/// задерживать одно другим.
pub async fn run(inner: Arc<Inner>, url: String, generation: u64) {
    // Крипто-провайдер должен быть установлен до первого TLS-соединения.
    ensure_crypto_provider();

    // Пауза при серии неудач. Статус уже CONNECTING (выставил `connect()`),
    // сообщения копятся в буфере. Задача при этом прерываема через reset().
    let delay = backoff_delay(inner.fail_streak.load(Ordering::Acquire));
    if !delay.is_zero() {
        inner.emit_json("info", json!(format!("[WebSocket] reconnect backoff: {}ms", delay.as_millis())));
        sleep(delay).await;
        if !inner.is_current(generation) {
            return;
        }
    }

    // Разбираем URL. Ошибка на этом шаге означает, что вызывающий передал
    // мусор — сообщаем наверх через события и выходим.
    let request = match url.as_str().into_client_request() {
        Ok(req) => req,
        Err(e) => {
            fail_connect(&inner, generation, format!("invalid url: {e}"), true);
            return;
        }
    };

    // Диагностическое сообщение: полезно при отладке проблем с подключением.
    inner.emit_json("info", json!(format!("[WebSocket] connecting to {url}")));

    // Устанавливаем соединение. Ошибка здесь — не паника: сообщаем
    // наверх и выходим, чтобы вызывающий мог решить, что делать.
    let (ws, _) = match timeout(CONNECT_TIMEOUT, connect_async(request)).await {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            // Обрыв/ошибка I/O на рукопожатии — сетевой сбой, а не
            // «плохой запрос»: переподключение имеет смысл.
            let transient = matches!(e, WsError::Io(_) | WsError::ConnectionClosed);
            fail_connect(&inner, generation, e.to_string(), !transient);
            return;
        }
        Err(_) => {
            let msg = format!("connect timeout ({}s)", CONNECT_TIMEOUT.as_secs());
            fail_connect(&inner, generation, msg, false);
            return;
        }
    };

    // Разделяем соединение на две половины: sink для записи, stream для чтения.
    // Каждая половина используется своей задачей и не пересекается с другой.
    let (mut sink, mut stream) = ws.split();

    // Неограниченный канал: продюсер (наш код и внешние вызовы) не должен
    // блокироваться при отправке. Ограничение здесь бессмысленно: если
    // сеть не успевает, пакеты всё равно накопятся, а блокировать
    // вызывающего — хуже, чем принять их в очередь.
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Публикуем отправителя в общем состоянии. Если пока мы подключались,
    // случился reset()/новый connect(), метод вернёт `false` — тихо уходим
    // (сокет закроется при выходе из функции).
    if !inner.mark_connected(generation, tx) {
        return;
    }

    // Канал, по которому heartbeat (или задача записи) попросит остановить
    // это соединение.
    let (kill_tx, mut kill_rx) = oneshot::channel::<()>();
    if !inner.mark_opened(generation, kill_tx) {
        return;
    }

    // С этого момента соединение считается открытым.
    inner.ready.store(true, Ordering::SeqCst);
    inner.status.store(ws_codes::status::OPEN, Ordering::SeqCst);

    // Уведомляем подписчика: соединение установлено.
    inner.emit("open", None, None);
    inner.emit_json("info", json!("[WebSocket] has open connection"));

    // Отдельная задача на отправку: перекладывает сообщения из канала в sink.
    // Живёт до тех пор, пока канал не будет освобождён (rx.recv() == None).
    //
    // Любая ошибка или зависание записи означают мёртвое соединение:
    // просим основной цикл остановиться, чтобы транспорт узнал об обрыве
    // сразу, а не по тайм-ауту heartbeat. Все ожидания ограничены по
    // времени, поэтому «осиротевшая» после reset() задача не живёт вечно.
    let writer_inner = Arc::clone(&inner);
    let mut write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match timeout(WRITE_TIMEOUT, sink.send(msg)).await {
                Ok(Ok(())) => {}
                _ => {
                    writer_inner.kill_connection(generation);
                    break;
                }
            }
        }
        // Закрываем sink при выходе: Discord получит чистый кадр Close.
        let _ = timeout(WRITE_CLOSE_TIMEOUT, sink.close()).await;
    });

    // Основной цикл чтения. `stream.next()` возвращает None при закрытии
    // потока; Some(Err) — при ошибке протокола или ввода-вывода.
    loop {
        let item = tokio::select! {
            biased;

            // Остановку запросили изнутри (heartbeat-timeout, сбой записи)
            // либо sender выброшен из-за reset(). Событие `close` при
            // необходимости уже отправлено тем, кто попросил.
            _ = &mut kill_rx => break,

            item = stream.next() => item,
        };
        let Some(result) = item else { break };

        // Соединение заменено, пока мы ждали кадр: ничего не обрабатываем,
        // иначе устаревшие события дошли бы до транспорта.
        if !inner.is_current(generation) {
            break;
        }

        // Любой кадр — признак жизни; heartbeat учитывает это при
        // задержке ACK.
        inner.last_rx_ms.store(mono_ms(), Ordering::Relaxed);

        match result {
            // Текстовый кадр — это JSON-сообщение Discord.
            Ok(Message::Text(text)) => handle_text(&inner, generation, text.as_str()),

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
                inner.finish_connection(generation, code, reason);
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
    // сообщаем наверх как "аварийное закрытие" с кодом 1006. Если `close`
    // уже отправлен (Close-кадр, heartbeat-timeout) — вызов ничего не делает.
    inner.finish_connection(
        generation,
        1006,
        "Abnormal closure (connection reset or stream ended without close frame)"
    );

    // Соединение уже заменено или сброшено (транспорт реагирует на `close`
    // мгновенно): reset() всё очистил, а общее состояние теперь принадлежит
    // новому соединению. Трогать его нельзя. Задача записи завершится сама:
    // канал закрыт, а все её ожидания ограничены по времени.
    if !inner.is_current(generation) {
        return;
    }

    // Переводим состояние в "закрывается".
    inner.status.store(ws_codes::status::CLOSING, Ordering::SeqCst);
    inner.ready.store(false, Ordering::SeqCst);

    // Возвращаем sink в состояние буферизации и освобождаем прежний канал —
    // это разбудит задачу записи (rx.recv() вернёт None).
    let _ = inner.mark_disconnected_for(generation);

    // Аккуратное закрытие вместо мгновенного прерывания: после освобождения
    // tx цикл записи завершится и выполнится `sink.close()` — Discord получит
    // чистый кадр Close. Если за WRITE_TASK_CLOSE_TIMEOUT задача не
    // завершилась (зависла на вводе-выводе), прерываем принудительно.
    if timeout(WRITE_TASK_CLOSE_TIMEOUT, &mut write_task).await.is_err() {
        write_task.abort();
        let _ = write_task.await;
    }

    // За время ожидания могли переподключиться: heartbeat и статус
    // теперь чужие.
    if !inner.is_current(generation) {
        return;
    }

    // Останавливаем heartbeat: соединение закрыто, пульс больше не нужен.
    heartbeat::stop(&inner);

    // Финальное состояние — "закрыто". Снаружи это видно через `socket.status`.
    inner.status.store(ws_codes::status::CLOSED, Ordering::SeqCst);
}

/// Обрабатывает текстовый кадр: разбирает JSON и вызывает соответствующее
/// событие на JS-стороне в зависимости от поля `op`.
fn handle_text(inner: &Arc<Inner>, generation: u64, text: &str) {
    // Парсим JSON. Битая строка — пропускаем кадр: без разбора всё равно
    // ничего не сделать. Событие `error` здесь не годится: транспорт трактует
    // его как фатальную ошибку и закрывает сессию из-за одного кадра, хотя
    // соединение при этом живо. Достаточно `info` для диагностики.
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            inner.emit_json("info", json!("[WebSocket] dropped frame with invalid JSON"));
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

    // Диспетчеризация по коду операции: каждому — своё событие наружу.
    match op_code {
        // Пульс подтверждён — сбрасываем ожидание в heartbeat.
        discord_opcode::voice::HEARTBEAT_ACK => heartbeat::ack(inner),

        // Сервер представился: содержит интервал пульса. Запускаем heartbeat.
        discord_opcode::voice::HELLO => {
            if let Some(interval) = payload
                .get("d")
                .and_then(|d| d.get("heartbeat_interval"))
                .and_then(|v| v.as_u64())
            {
                // heartbeat::start сам ограничивает интервал разумными
                // рамками, здесь дополнительная проверка не нужна.
                heartbeat::start(inner.clone(), interval, generation);
            }
        }

        // Кто-то начал или закончил говорить. Полезно для индикации в UI.
        discord_opcode::voice::SPEAKING => inner.emit_json("speaking", payload),

        // Кто-то подключился к голосовому каналу или отключился.
        discord_opcode::voice::CLIENTS_CONNECT | discord_opcode::voice::CLIENT_DISCONNECT => inner.emit_json("Users", payload),

        // Соединение готово к работе: содержит SSRC, порты, режимы шифрования.
        discord_opcode::voice::READY => inner.emit_json("ready", payload),

        // Описание сессии: ключ шифрования для голоса.
        discord_opcode::voice::SESSION_DESCRIPTION => inner.emit_json("sessionDescription", payload),

        // Сессия успешно восстановлена после переподключения.
        discord_opcode::voice::RESUMED => inner.emit_json("resumed", payload),

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Без серии неудач пауза не нужна.
    fn backoff_is_zero_without_failures() {
        assert_eq!(backoff_delay(0), Duration::ZERO);
    }

    #[test]
    // Пауза растёт, но никогда не выходит за потолок (с учётом джиттера).
    fn backoff_grows_and_is_capped() {
        for streak in 1..=32u32 {
            let d = backoff_delay(streak);
            assert!(d > Duration::ZERO);
            assert!(d <= Duration::from_millis(BACKOFF_MAX_MS), "streak {streak}: {d:?}");
        }
        // Первая пауза укладывается в 0.5 с ±20 %.
        let first = backoff_delay(1);
        assert!(first >= Duration::from_millis(400) && first <= Duration::from_millis(600));
    }
}