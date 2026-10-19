use crate::structures::network::ws::runtime;
use crate::utils::duration::now_ms;
use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::task::JoinHandle;

/// Время ожидания ACK до `on_timeout`.
///
/// 10 секунд совпадает с типичным значением в протоколе Discord.
/// Компромисс между двумя крайностями: слишком короткий тайм-аут
/// даёт ложные срабатывания при сетевых задержках, слишком длинный
/// оставляет состояние «завис» дольше, чем нужно.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_millis(10_000);

/// Внешние функции менеджера (`HeartbeatHooks`).
///
/// `send` и `on_ack` опциональны — если их нет, соответствующая фаза
/// просто ничего не делает. `on_timeout` обязателен: без него менеджер
/// не знал бы, как реагировать на пропуск.
pub struct HeartbeatHooks {
    /// Вызывается на каждом тике; аргумент — время отправки (мс).
    ///
    /// Типичное использование: отправить heartbeat-пакет с этим
    /// временем и последним полученным seq. `None` — тик работает
    /// как чистый таймер (например, в `VoiceSpeakerManager`).
    pub send: Option<Box<dyn Fn(u64) + Send + Sync>>,

    /// Вызывается, если ACK не получен вовремя.
    ///
    /// Типичное использование: закрыть соединение с кодом
    /// `SESSION_TIMEOUT` или сбросить состояние спикера в `Disable`.
    /// Обязателен: без него менеджер не знает, что делать при пропуске.
    pub on_timeout: Box<dyn Fn() + Send + Sync>,

    /// Вызывается при ACK; аргумент — задержка (мс).
    ///
    /// Задержка = время от `last_sent` до момента `ack`. Полезна
    /// для метрик и диагностики: растёт — сеть деградирует,
    /// стабильно малое — всё хорошо. `None` — ACK подтверждается,
    /// но метрика не нужна.
    pub on_ack: Option<Box<dyn Fn(u64) + Send + Sync>>
}

/// Внутреннее состояние менеджера.
///
/// Отдельно от `HeartbeatManager`: задачи держат только слабую ссылку
/// и завершаются, когда владелец исчез. Прямые ссылки создавали бы
/// цикл: задача → замыкание → `Inner` → `HeartbeatManager` → задача.
struct Inner {
    /// Хуки. `None` после `destroy()`.
    ///
    /// `Mutex<Option<Arc<...>>>` — потому что `destroy` их освобождает,
    /// а задачи читают их для вызова. `Arc` — чтобы клонировать
    /// и отпускать мьютекс до вызова хука (хук может быть произвольным
    /// кодом и попытаться залочить тот же мьютекс).
    hooks: Mutex<Option<Arc<HeartbeatHooks>>>,

    /// Задача тиков. Хранится, чтобы её можно было прервать в `stop`.
    interval_task: Mutex<Option<JoinHandle<()>>>,

    /// Задача ожидания ACK. Хранится по той же причине.
    timeout_task: Mutex<Option<JoinHandle<()>>>,

    /// Время последнего ACK (мс от эпохи). 0 — ACK ещё не было.
    last_ack: AtomicU64,

    /// Время последней отправки (мс от эпохи). 0 — отправок ещё не было.
    last_sent: AtomicU64,

    /// Количество подряд пропущенных ACK. Сбрасывается при `ack` и `stop`.
    misses: AtomicU32,

    /// Текущий интервал (мс). 0 — heartbeat остановлен.
    /// Хранится в `Inner`, а не в `HeartbeatManager`, чтобы задача тиков
    /// видела изменения через слабую ссылку. `destroy` обнуляет его,
    /// и цикл завершается на следующей проверке.
    interval_ms: AtomicU64
}

impl Inner {
    /// Взводит таймер ожидания ACK (предыдущий отменяется).
    ///
    /// Гонка с `ack`: если оба срабатывают одновременно, худшее, что
    /// случится, — `on_timeout` сработает при ACK, пришедшем в последний
    /// момент; `misses` останется ненулевым до следующего `ack`.
    /// Это не баг, а неизбежное свойство таймеров: между «сработал»
    /// и «пришёл ACK» всегда есть окно, и мы предпочитаем ложное
    /// срабатывание пропущенному.
    fn arm_timeout(this: &Arc<Inner>) {
        let mut slot = this.timeout_task.lock();

        // Прерываем предыдущий таймер: каждый тик перезапускает ожидание
        // заново. Старый таймер при этом отменяется — он уже неактуален.
        if let Some(old) = slot.take() {
            old.abort();
        }

        // Слабая ссылка: если менеджер уничтожен, задача завершится тихо,
        // не пытаясь достучаться до освобождённых данных.
        let weak = Arc::downgrade(this);
        *slot = Some(runtime::spawn(async move {
            // Спим весь тайм-аут. В это время `ack` может отменить
            // задачу через `abort` — тогда `sleep` не проснётся,
            // и мы выйдем на `abort`.
            tokio::time::sleep(HEARTBEAT_TIMEOUT).await;

            // Менеджер мог быть уничтожен за время сна — выходим тихо.
            let Some(inner) = weak.upgrade() else { return };

            // Учитываем пропуск ДО вызова хука: если хук сам вызовет
            // `ack` (как делает спикер), счётчик будет сброшен, но
            // хук уже увидит, что пропуск был.
            inner.misses.fetch_add(1, Ordering::Relaxed);

            // Клонируем `Arc`, чтобы не держать мьютекс во время хука.
            // Хук может быть произвольным кодом и, теоретически,
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
/// Методы принимают `&self`: состояние меняется через `Atomic` и `Mutex`.
/// При `Drop` все задачи прерываются — иначе они жили бы до конца
/// своего `sleep` (до 10 с), прежде чем увидели бы мёртвый `Weak`.
pub struct HeartbeatManager {
    inner: Arc<Inner>,
}

impl HeartbeatManager {
    /// Создаёт менеджер с указанными хуками. Тики не запускаются.
    ///
    /// Тики запускаются явно через `start(...)`. Это позволяет
    /// настроить менеджер (например, установить интервал) до старта.
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

    /// Запускает heartbeat; предыдущий останавливается.
    ///
    /// * `Some(ms)` — задаёт новый интервал (`0` — остановка с забыванием
    ///   прежнего интервала);
    /// * `None` — использует ранее сохранённый интервал. Если он нулевой,
    ///   тики не запускаются.
    ///
    /// Лок `interval_task` держится на всём протяжении метода, поэтому
    /// параллельные `start()` не могут породить два цикла. Это важно:
    /// два цикла от одного менеджера — это два `send` в один и тот же
    /// момент и два таймера ожидания, что сломало бы всю логику.
    pub fn start(&self, interval_ms: Option<u64>) {
        let mut slot = self.inner.interval_task.lock();
        self.stop_locked(&mut slot);

        // Обновляем интервал, только если он передан явно.
        // `None` означает «использовать прежний».
        if let Some(ms) = interval_ms {
            self.inner.interval_ms.store(ms, Ordering::Relaxed);
        }

        // Интервал нулевой — тики не запускаем.
        if self.inner.interval_ms.load(Ordering::Relaxed) == 0 {
            return;
        }

        let weak = Arc::downgrade(&self.inner);
        *slot = Some(runtime::spawn(async move {
            loop {
                // Проверка ДО сна: `destroy()` мог обнулить интервал.
                // Проверка ДО сна важна: если интервал сброшен, спать
                // незачем — выходим сразу.
                let ms = match weak.upgrade() {
                    Some(inner) => inner.interval_ms.load(Ordering::Relaxed),
                    None => break,
                };
                if ms == 0 {
                    break;
                }

                tokio::time::sleep(Duration::from_millis(ms)).await;

                // Повторная проверка после сна: за время сна менеджер
                // мог быть уничтожен или интервал мог стать нулевым.
                let Some(inner) = weak.upgrade() else { break };
                if inner.interval_ms.load(Ordering::Relaxed) == 0 {
                    break;
                }

                // Время отправки фиксируем ДО вызова хука, чтобы
                // `latency()` внутри хука и в последующем `ack` видел
                // корректное значение.
                let now = now_ms();
                inner.last_sent.store(now, Ordering::Relaxed);

                // Мьютекс отпускаем до вызова хука: хук может делать
                // что угодно, включая попытку залочить тот же мьютекс.
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
        }));
    }

    /// Обработка ACK: обновляет `last_ack`, сбрасывает `misses`, отменяет
    /// ожидание тайм-аута и вызывает `on_ack` с задержкой.
    ///
    /// # Порядок действий
    ///
    /// 1. `last_ack = now` — для метрики `latency`.
    /// 2. `misses = 0` — сбрасываем счётчик пропусков.
    /// 3. `abort` таймера ожидания — ACK пришёл, ждать больше нечего.
    /// 4. Вызов `on_ack` с задержкой — после отпускания мьютекса.
    ///
    /// Если `ack` приходит, когда таймера уже нет (например, после
    /// `stop`), шаги 3–4 просто ничего не делают — это корректно.
    pub fn ack(&self) {
        let now = now_ms();
        self.inner.last_ack.store(now, Ordering::Relaxed);

        // `saturating_sub` — на случай, если `last_sent` ещё 0
        // (первый ACK пришёл до первого тика, что теоретически
        // возможно при очень быстром сервере).
        let latency = now.saturating_sub(self.inner.last_sent.load(Ordering::Relaxed));

        self.inner.misses.store(0, Ordering::Relaxed);
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

    /// Количество подряд пропущенных ACK.
    ///
    /// Сбрасывается в 0 при успешном `ack` и в `stop`. Если хук
    /// `on_timeout` сам вызывает `ack` (как делает спикер), счётчик
    /// обнуляется сразу после срабатывания — то есть `misses()`
    /// вернёт 0 уже на следующем чтении.
    pub fn misses(&self) -> u32 {
        self.inner.misses.load(Ordering::Relaxed)
    }

    /// Время последнего ACK (мс от эпохи), `0` — ACK ещё не было.
    ///
    /// Используется для диагностики: если значение давно не менялось,
    /// а heartbeat отправляется — что-то не так с соединением.
    pub fn last_ack_ms(&self) -> u64 {
        self.inner.last_ack.load(Ordering::Relaxed)
    }

    /// Задержка последнего обмена (мс): `last_ack - last_sent`.
    /// `None`, если обмена ещё не было.
    ///
    /// `then(|| ...)` — вычисляет замыкание только если условие истинно.
    /// `ack != 0 && sent != 0` — оба значения должны быть установлены,
    /// иначе разница бессмысленна.
    pub fn latency(&self) -> Option<u64> {
        let ack = self.inner.last_ack.load(Ordering::Relaxed);
        let sent = self.inner.last_sent.load(Ordering::Relaxed);
        (ack != 0 && sent != 0).then(|| ack.saturating_sub(sent))
    }

    /// Останавливает все таймеры и сбрасывает счётчики.
    ///
    /// Интервал НЕ сбрасывается: можно снова вызвать `start(None)`
    /// и продолжить с прежним интервалом. Это отличается от `destroy`,
    /// который обнуляет и интервал.
    pub fn stop(&self) {
        let mut slot = self.inner.interval_task.lock();
        self.stop_locked(&mut slot);
    }

    /// Тело `stop` для случая, когда лок `interval_task` уже взят.
    ///
    /// Порядок локов везде одинаков: `interval_task` -> `timeout_task`.
    /// Это важно для `start`: там лок `interval_task` уже взят,
    /// и мы вызываем `stop_locked`, а не `stop`, чтобы не пытаться
    /// взять его снова (дедлок).
    fn stop_locked(&self, interval_slot: &mut Option<JoinHandle<()>>) {
        if let Some(task) = interval_slot.take() {
            task.abort();
        }
        if let Some(task) = self.inner.timeout_task.lock().take() {
            task.abort();
        }

        // Сбрасываем счётчики, чтобы следующая сессия начиналась
        // с чистого состояния.
        self.inner.misses.store(0, Ordering::Relaxed);
        self.inner.last_sent.store(0, Ordering::Relaxed);
        self.inner.last_ack.store(0, Ordering::Relaxed);
    }

    /// Останавливает и освобождает всё, включая хуки.
    ///
    /// После `destroy` менеджер нельзя переиспользовать: хуки убраны,
    /// интервал обнулён. Следующий `start(...)` создаст новый цикл,
    /// но хуки уже `None`, и `send` не вызовется.
    pub fn destroy(&self) {
        // Сначала обнуляем интервал, чтобы цикл не перезапустился.
        // Порядок важен: если сделать `stop` первым, цикл мог бы
        // успеть прочитать старый интервал и создать новый `timeout_task`.
        self.inner.interval_ms.store(0, Ordering::Relaxed);
        self.stop();
        *self.inner.hooks.lock() = None;
    }
}

impl Drop for HeartbeatManager {
    /// Без этого задачи жили бы до конца своего `sleep` (до 10 с),
    /// прежде чем увидели бы мёртвый `Weak`.
    ///
    /// Даже `Weak` не спасает от задержки: `sleep` уже идёт, и просто
    /// так его не прервать — только `abort`. `destroy` явно прерывает
    /// обе задачи.
    fn drop(&mut self) {
        self.destroy();
    }
}