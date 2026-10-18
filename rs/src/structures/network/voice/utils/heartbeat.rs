use crate::structures::network::ws::runtime;
use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::task::JoinHandle;
use crate::utils::duration::now_ms;

/// Время ожидания ACK до `on_timeout`.
///
/// Компромисс между двумя крайностями: слишком короткий тайм-аут даёт
/// ложные срабатывания при сетевых задержках, слишком длинный оставляет
/// состояние «завис» дольше, чем нужно. 10 секунд совпадает с типичным
/// значением в протоколе Discord.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_millis(10_000);

/// Внешние функции менеджера (`HeartbeatHooks`).
///
/// `send` и `on_ack` опциональны: если их нет, соответствующая фаза
/// просто ничего не делает. `on_timeout` обязателен — без него
/// менеджер не знал бы, как реагировать на пропуск.
pub struct HeartbeatHooks {
    /// Вызывается на каждом тике; аргумент — время отправки (мс).
    pub send: Option<Box<dyn Fn(u64) + Send + Sync>>,
    
    /// Вызывается, если ACK не получен вовремя.
    pub on_timeout: Box<dyn Fn() + Send + Sync>,
    
    /// Вызывается при ACK; аргумент — задержка (мс).
    pub on_ack: Option<Box<dyn Fn(u64) + Send + Sync>>
}

/// Внутреннее состояние менеджера.
///
/// Отдельная структура от `HeartbeatManager`, потому что на неё смотрят
/// порождённые задачи: сам менеджер может быть уничтожен, а задачи
/// в этот момент ещё живы. Слабая ссылка на `Inner` позволяет задачам
/// завершиться, когда владелец исчез.
struct Inner {
    /// Хуки. `Mutex<Option<...>>` — потому что `destroy()` их убирает,
    /// а `Option` нужен, чтобы отличить «ещё не уничтожен» от «уже».
    hooks: Mutex<Option<Arc<HeartbeatHooks>>>,

    /// Задача тиков. Хранится, чтобы её можно было прервать в `stop`.
    interval_task: Mutex<Option<JoinHandle<()>>>,

    /// Задача ожидания ACK. Хранится по той же причине.
    timeout_task: Mutex<Option<JoinHandle<()>>>,

    /// Время последнего ACK (мс от эпохи). 0 — ACK ещё не было.
    last_ack: AtomicU64,

    /// Время последней отправки (мс от эпохи). 0 — отправок ещё не было.
    last_sent: AtomicU64,

    /// Количество подряд пропущенных ACK. Сбрасывается при `ack`
    /// и в `stop`.
    misses: AtomicU32,

    /// Текущий интервал (мс). 0 — heartbeat остановлен.
    /// Хранится в `Inner`, а не в `HeartbeatManager`, чтобы задача тиков
    /// видела изменения через слабую ссылку.
    interval_ms: AtomicU64
}

impl Inner {
    /// Взводит таймер ожидания ACK (предыдущий отменяется).
    ///
    /// Использует слабую ссылку на `Inner`: если менеджер уничтожен,
    /// задача тихо завершится, не пытаясь достучаться до освобождённых
    /// данных.
    ///
    /// Гонка с `ack`: `ack` тоже пытается прервать `timeout_task`.
    /// Если оба срабатывают одновременно, второй увидит уже `None` или
    /// уже сработавший таймер. Худшее, что случится, — `on_timeout`
    /// сработает при ACK, пришедшем в последний момент; счётчик `misses`
    /// в этом случае может кратковременно остаться ненулевым до
    /// следующего `ack`.
    fn arm_timeout(this: &Arc<Inner>) {
        let mut slot = this.timeout_task.lock();

        // Прерываем предыдущий таймер: каждый тик перевзводит ожидание
        // заново. Старый таймер при этом отменяется — он уже неактуален.
        if let Some(old) = slot.take() {
            old.abort();
        }

        let weak = Arc::downgrade(this);
        *slot = Some(runtime::spawn(async move {
            tokio::time::sleep(HEARTBEAT_TIMEOUT).await;

            // Менеджер мог быть уничтожен за время сна — выходим тихо.
            let Some(inner) = weak.upgrade() else { return };

            // Учитываем пропуск ДО вызова хука: если хук сам вызовет
            // `ack` (как делает спикер), счётчик будет сброшен, но
            // хук уже увидит, что пропуск был.
            inner.misses.fetch_add(1, Ordering::SeqCst);

            // Клонируем `Arc`, чтобы не держать мьютекс во время вызова
            // хука. Хук может быть произвольным кодом и, теоретически,
            // попытаться залочить тот же мьютекс.
            let hooks = inner.hooks.lock().clone();
            if let Some(hooks) = hooks {
                (hooks.on_timeout)();
            }
        }));
    }
}

/// Менеджер heartbeat.
///
/// Живёт в одном экземпляре на компонент (спикер, WebSocket и т.п.),
/// поэтому методы принимают `&self`, а не `&mut self`: состояние
/// меняется через `Atomic`-поля и `Mutex`.
pub struct HeartbeatManager {
    inner: Arc<Inner>,
}

impl HeartbeatManager {
    /// Создаёт менеджер с указанными хуками.
    ///
    /// Тики не запускаются: для этого нужно вызвать `start(...)`.
    pub fn new(hooks: HeartbeatHooks) -> Self {
        Self {
            inner: Arc::new(Inner {
                hooks: Mutex::new(Some(Arc::new(hooks))),
                interval_task: Mutex::new(None),
                timeout_task: Mutex::new(None),
                last_ack: AtomicU64::new(0),
                last_sent: AtomicU64::new(0),
                misses: AtomicU32::new(0),
                interval_ms: AtomicU64::new(0)
            }),
        }
    }

    /// Текущая задержка send -> ack (мс).
    ///
    /// `saturating_sub` нужен на случай, если `ack` пришёл раньше, чем
    /// `send`: при нулевых значениях (никогда не было ни отправки,
    /// ни ACK) это даёт 0, а не отрицательное число.
    pub fn latency(&self) -> u64 {
        self.inner
            .last_ack
            .load(Ordering::SeqCst)
            .saturating_sub(self.inner.last_sent.load(Ordering::SeqCst))
    }

    /// Количество подряд пропущенных ACK.
    ///
    /// Сбрасывается в 0 при успешном `ack` и в `stop`. Если хук
    /// `on_timeout` сам вызывает `ack`, счётчик обнуляется сразу после
    /// срабатывания — то есть `missed()` вернёт 0 уже на следующем
    /// чтении.
    pub fn missed(&self) -> u32 {
        self.inner.misses.load(Ordering::SeqCst)
    }

    /// Запускает heartbeat; предыдущий останавливается.
    ///
    /// Семантика аргумента:
    /// * `Some(ms)` — задаёт новый интервал (в том числе `0`, что
    ///   эквивалентно остановке с забыванием прежнего интервала);
    /// * `None` — использует ранее сохранённый интервал. Если он
    ///   нулевой (никогда не задавался), тики не запускаются.
    pub fn start(&self, interval_ms: Option<u64>) {
        // Останавливаем предыдущий цикл: он может работать с другим
        // интервалом или быть в середине сна.
        self.stop();

        // Обновляем интервал, только если он передан явно.
        // `None` означает «использовать прежний».
        if let Some(ms) = interval_ms {
            self.inner.interval_ms.store(ms, Ordering::SeqCst);
        }

        // Интервал нулевой — тики не запускаем.
        if self.inner.interval_ms.load(Ordering::SeqCst) == 0 {
            return;
        }

        let weak = Arc::downgrade(&self.inner);
        let handle = runtime::spawn(async move {
            loop {
                // Проверяем интервал на каждом витке: `destroy()` может
                // выставить его в 0, и цикл должен завершиться.
                // Проверка ДО сна: если интервал уже сброшен, спать
                // незачем.
                let ms = match weak.upgrade() {
                    Some(inner) => inner.interval_ms.load(Ordering::SeqCst),
                    None => break,
                };
                if ms == 0 {
                    break;
                }

                tokio::time::sleep(Duration::from_millis(ms)).await;

                // Повторная проверка после сна: за время сна менеджер
                // мог быть уничтожен или интервал мог стать нулевым.
                let Some(inner) = weak.upgrade() else { break };
                if inner.interval_ms.load(Ordering::SeqCst) == 0 {
                    break;
                }

                // Фиксируем время отправки ДО вызова хука, чтобы
                // `latency()` внутри хука и в последующем `ack` видел
                // корректное значение.
                let now = now_ms();
                inner.last_sent.store(now, Ordering::SeqCst);

                // Клонируем `Arc` и отпускаем мьютекс до вызова хука:
                // хук может делать что угодно, включая попытку залочить
                // тот же мьютекс.
                let hooks = inner.hooks.lock().clone();
                if let Some(hooks) = hooks {
                    if let Some(send) = &hooks.send {
                        send(now);
                    }
                }

                // Взводим ожидание ACK. Таймер будет отменён либо
                // следующим тиком (через `arm_timeout`), либо `ack`.
                Inner::arm_timeout(&inner);
            }
        });

        *self.inner.interval_task.lock() = Some(handle);
    }

    /// Обработка ACK.
    ///
    /// Обновляет `last_ack`, сбрасывает счётчик пропусков, отменяет
    /// ожидание тайм-аута и вызывает `on_ack` с задержкой.
    pub fn ack(&self) {
        let now = now_ms();
        self.inner.last_ack.store(now, Ordering::SeqCst);

        // Задержка = время от последней отправки до текущего ACK.
        // `saturating_sub` — на случай, если `last_sent` ещё 0
        // (первый ACK пришёл до первого тика, что теоретически возможно).
        let latency = now.saturating_sub(self.inner.last_sent.load(Ordering::SeqCst));

        self.inner.misses.store(0, Ordering::SeqCst);
        if let Some(timer) = self.inner.timeout_task.lock().take() {
            timer.abort();
        }

        let hooks = self.inner.hooks.lock().clone();
        if let Some(hooks) = hooks {
            if let Some(on_ack) = &hooks.on_ack {
                on_ack(latency);
            }
        }
    }

    /// Останавливает все таймеры и сбрасывает счётчики.
    ///
    /// Интервал НЕ сбрасывается: после `stop` можно снова вызвать
    /// `start(None)` и продолжить с прежним интервалом.
    pub fn stop(&self) {
        // Прерываем обе задачи. `abort` не блокирует — просто помечает
        // задачу как отменённую; следующая точка ожидания (sleep,
        // recv и т.п.) завершит её.
        if let Some(task) = self.inner.interval_task.lock().take() {
            task.abort();
        }
        if let Some(task) = self.inner.timeout_task.lock().take() {
            task.abort();
        }

        // Сбрасываем счётчики, чтобы следующая сессия начиналась
        // с чистого состояния.
        self.inner.misses.store(0, Ordering::SeqCst);
        self.inner.last_sent.store(0, Ordering::SeqCst);
        self.inner.last_ack.store(0, Ordering::SeqCst);
    }

    /// Останавливает и освобождает всё, включая хуки.
    ///
    /// В отличие от `stop`, после `destroy` менеджер нельзя
    /// переиспользовать: хуки убраны, интервал обнулён.
    pub fn destroy(&self) {
        self.stop();
        // Обнуляем интервал: следующий `start(None)` не запустит тики.
        self.inner.interval_ms.store(0, Ordering::SeqCst);
        // Освобождаем хуки — они могут держать большие замыкания
        // (например, слабые ссылки на другие компоненты).
        *self.inner.hooks.lock() = None;
    }
}