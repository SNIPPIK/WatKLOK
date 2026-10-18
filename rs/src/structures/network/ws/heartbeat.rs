use tokio::time::{interval, Duration, MissedTickBehavior};
use serde_json::json;
use std::sync::{
    atomic::Ordering, Arc
};
use tokio_tungstenite::tungstenite::Message;
use crate::structures::network::ws::{
    opcodes::{discord_opcode, close_codes},
    inner::Inner,
    runtime
};

// Общая функция времени — своя копия не нужна.
use crate::utils::duration::now_ms;

/// Допустимый диапазон heartbeat-интервала.
///
/// Нижняя граница (1 с) защищает от паники `tokio::time::interval`
/// на Duration::ZERO. Верхняя (5 мин) — от абсурдных значений, при
/// которых соединение заведомо отвалится раньше первого heartbeat.
const MIN_HEARTBEAT_MS: u64 = 1_000;
const MAX_HEARTBEAT_MS: u64 = 300_000;

/// Запускает цикл отправки heartbeat-пакетов.
///
/// Порядок работы:
/// 1. Прерывает предыдущую задачу heartbeat, если она была.
/// 2. Сбрасывает флаг ожидания ACK.
/// 3. Создаёт задачу в собственном runtime с интервалом `interval_ms`.
/// 4. Пропускает первый тик (он нужен только для синхронизации интервала).
/// 5. На каждом следующем тике:
///    - если `hb_pending` уже установлен — значит предыдущий heartbeat
///      не подтверждён: отправляем `close` с кодом `SESSION_TIMEOUT`
///      и выходим;
///    - иначе выставляем `hb_pending = true` и отправляем heartbeat-пакет
///      с текущим временем и последним полученным seq.
///
/// # Аргументы
/// * `inner` — общее состояние WebSocket-клиента.
/// * `interval_ms` — интервал между heartbeat в миллисекундах
///   (ограничивается диапазоном `MIN_HEARTBEAT_MS..=MAX_HEARTBEAT_MS`).
pub fn start(inner: Arc<Inner>, interval_ms: u64) {
    // Ограничиваем интервал: `tokio::time::interval` паникует на нулевой
    // длительности, а значение приходит из внешнего HELLO-пакета.
    // При нуле задача умирала бы молча (handle никто не дожидается),
    // и соединение отваливалось бы по серверному таймауту через ~40 с.
    let interval_ms = interval_ms.clamp(MIN_HEARTBEAT_MS, MAX_HEARTBEAT_MS);

    // Прерываем предыдущий heartbeat, если он ещё работает.
    if let Some(prev) = inner.hb_task.lock().take() {
        prev.abort();
    }
    // Начинаем с чистого состояния ожидания ACK.
    inner.hb_pending.store(false, Ordering::SeqCst);

    // Клонируем Arc для использования внутри задачи: она должна владеть
    // своей долей и не зависеть от времени жизни вызывающего.
    let inner_task = Arc::clone(&inner);

    // Наш runtime, а не tokio::spawn.
    let handle = runtime::spawn(async move {
        // Тикер с заданным интервалом.
        let mut ticker = interval(Duration::from_millis(interval_ms));

        // Skip вместо поведения по умолчанию (Burst). Если поток runtime'а
        // был занят дольше одного интервала (пауза сборщика мусора,
        // отладчик, планировщик ОС), Burst мгновенно прокрутит все
        // пропущенные тики: несколько heartbeat-пакетов подряд, и на
        // втором `hb_pending` уже `true` → ложный SESSION_TIMEOUT.
        // Skip просто дожидается следующего нормального тика.
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

        // Пропускаем первый тик — он срабатывает сразу и нужен только
        // для синхронизации последующих интервалов.
        ticker.tick().await;

        loop {
            // Ждём следующего тика.
            ticker.tick().await;

            // Если предыдущий heartbeat не получил ACK — это тайм-аут.
            // swap возвращает предыдущее значение, что позволяет
            // обнаружить пропуск без отдельных проверок.
            if inner_task.hb_pending.swap(true, Ordering::SeqCst) {
                inner_task.emit_json(
                    "close",
                    json!({
                        "code": close_codes::SESSION_TIMEOUT,
                        "reason": "HEARTBEAT_ACK timeout"
                    }),
                );
                return;
            }

            // Формируем heartbeat-пакет: текущее время и последний seq,
            // полученный от сервера. По ним сервер понимает, какую
            // часть нашей истории мы видели.
            let packet = json!({
                "op": discord_opcode::HEARTBEAT,
                "d": {
                    "t": now_ms(),
                    "seq_ack": inner_task.sequence.load(Ordering::SeqCst),
                }
            });

            // Отправляем, только если соединение активно. Буферизовать
            // heartbeat до подключения смысла нет — он устареет раньше,
            // чем дойдёт (см. Inner::send_if_connected).
            inner_task.send_if_connected(Message::Text(packet.to_string().into()));
        }
    });

    // Сохраняем handle задачи, чтобы её можно было прервать.
    *inner.hb_task.lock() = Some(handle);
}

/// Останавливает цикл heartbeat. Безопасен для повторного вызова.
pub fn stop(inner: &Arc<Inner>) {
    // Прерываем задачу heartbeat, если она активна.
    if let Some(handle) = inner.hb_task.lock().take() { handle.abort(); }

    // Сбрасываем флаг ожидания ACK — соединение закрывается, следующий
    // heartbeat уже не отправится, а оставшийся `true` только запутал бы
    // состояние при следующем старте.
    inner.hb_pending.store(false, Ordering::SeqCst);
}

/// Обрабатывает получение ACK на heartbeat.
///
/// Снимает флаг `hb_pending`, чтобы следующий тик мог отправить новый
/// heartbeat, а не сработал как тайм-аут.
pub fn ack(inner: &Arc<Inner>) {
    inner.hb_pending.store(false, Ordering::SeqCst);
}