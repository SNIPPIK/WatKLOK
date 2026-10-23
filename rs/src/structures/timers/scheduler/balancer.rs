use crate::structures::{
    network::udp::inner_socket::SocketInner,
    timers::scheduler::Scheduler,
};
use once_cell::sync::Lazy;
use std::{
    collections::HashMap,
    io,
    sync::{Arc, Mutex},
};

/// Максимум сессий на один воркер (поток тика).
///
/// Компромисс: больше — один поток не справляется с syscall'ами и тики
/// опаздывают; меньше — плодим потоки без нужды. 50 при тике 20 мс
/// означает ~2.5 мс на сессию — с запасом покрывает `send` + учёт.
const MAX_PER_WORKER: usize = 50;

/// Воркер: планировщик и сессии, которые на нём работают.
///
/// Два поля, потому что данные нужны в двух местах:
/// * `manager` — сам поток тика, ему нужен `id → Arc<SocketInner>`;
/// * `sessions` — карта для балансировщика (посчитать `session_count`,
///   удалить по id). Дублирование намеренное: `manager` может
///   использовать другую структуру (например, `Vec` с индексами),
///   и заставлять его возвращать `HashMap` было бы лишним coupling'ом.
///
/// Оба поля содержат `Arc<SocketInner>` — это N инкрементов refcount,
/// не N копий. Дешевле, чем кажется на первый взгляд.
struct Worker {
    manager: Scheduler,
    sessions: HashMap<u32, Arc<SocketInner>>,
}

impl Worker {
    /// Создаёт пустой worker.
    fn new() -> Self {
        Self {
            manager: Scheduler::new(),
            sessions: HashMap::new(),
        }
    }

    /// Проверяет, пуст ли worker.
    #[inline]
    fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Возвращает количество сессий.
    #[inline]
    fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Проверяет наличие свободного места.
    #[inline]
    fn has_capacity(&self) -> bool {
        self.session_count() < MAX_PER_WORKER
    }
}

/// Балансировщик: список воркеров и индекс `session_id -> worker_index`.
///
/// `session_map` нужен, чтобы `remove_session(id)` за O(1) находил
/// воркер, на котором висит сессия. Без него пришлось бы обходить
/// всех воркеров и искать `sessions.contains_key(id)` — O(N*M).
pub struct AutoBalancer {
    /// Список worker'ов.
    ///
    /// При очистке может использоваться `swap_remove`, поэтому индексы
    /// могут изменяться.
    workers: Vec<Worker>,

    /// Быстрый поиск worker по `session_id`.
    session_map: HashMap<u32, usize>,
}

impl Default for AutoBalancer {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoBalancer {
    /// Создаёт балансировщик с одним (остановленным) воркером.
    ///
    /// Один воркер создаётся заранее, чтобы первый `add_session`
    /// не тратил время на `create_worker`. Сам поток тика
    /// (`Scheduler::new`) запускается лениво — при первом
    /// `add_session`.
    pub fn new() -> Self {
        let mut balancer = Self {
            workers: Vec::new(),
            session_map: HashMap::new(),
        };
        balancer.create_worker();
        balancer
    }

    /// Добавляет нового воркера в конец списка.
    ///
    /// Возвращает индекс нового воркера — вызывающий сразу в него
    /// кладёт сессию. Вынесено в отдельный метод, потому что
    /// создание воркера нужно в двух местах: в `new` и в `add_session`
    /// (когда все существующие заполнены).
    #[inline]
    fn create_worker(&mut self) -> usize {
        let index = self.workers.len();
        self.workers.push(Worker::new());
        index
    }

    /// Останавливает и удаляет пустые воркеры (кроме последнего).
    ///
    /// # Почему `swap_remove`
    ///
    /// `Vec::remove` сдвигает все элементы после удалённого на одну
    /// позицию — O(N) и инвалидация всех индексов в `session_map`
    /// для сдвинутых воркеров. `swap_remove` переносит последний
    /// элемент на место удалённого — O(1), но **только у одного**
    /// воркера меняется индекс: того, что был последним.
    ///
    /// Отсюда проверка `if empty_index != last_index`: если удалили
    /// не последний, надо обновить индексы сессий перенесённого
    /// воркера. Если удалили последний — обновлять нечего,
    /// `session_map` для его сессий уже пуст (воркер был пуст).
    ///
    /// # Почему «кроме последнего»
    ///
    /// Всегда оставляем хотя бы одного воркера — иначе `add_session`
    /// некуда будет класть сессию без создания нового, а `new`
    /// создаёт ровно одного. Так «один воркер всегда есть» становится
    /// инвариантом, на который можно опираться.
    fn cleanup_empty_workers(&mut self) {
        while self.workers.len() > 1 {
            let Some(empty_index) = self.workers.iter().position(Worker::is_empty) else {
                break;
            };
            let last_index = self.workers.len() - 1;

            // Явный `shutdown` до `swap_remove`: `Scheduler::Drop`
            // тоже должен останавливать поток, но явный вызов
            // гарантирует, что к моменту перестановки воркер уже
            // не тикает. `swap_remove` сам по себе просто переносит
            // значение — `Drop` старого произойдёт, но порядок
            // относительно перестановки нам важен.
            self.workers[empty_index].manager.shutdown();
            self.workers.swap_remove(empty_index);

            // Обновляем `session_map` для перенесённого воркера.
            // Если удалили последний — переносить нечего, и цикл
            // пустой.
            if empty_index != last_index {
                for session_id in self.workers[empty_index].sessions.keys() {
                    self.session_map.insert(*session_id, empty_index);
                }
            }
        }
    }

    /// Удаляет сессию. Снятые `Arc` кладутся в `dropped`: вызывающий
    /// освобождает их уже вне глобального лока.
    ///
    /// # Зачем `dropped` как параметр
    ///
    /// `Arc<SocketInner>::drop` может быть дорогим: `SocketInner`
    /// содержит `RingBuffer`, у которого в `Drop` освобождаются
    /// все слоты, а каждый слот — `Vec<u8>`. На сотнях пакетов это
    /// заметно. Освобождать это под глобальным локом
    /// `GLOBAL_BALANCER` — значит блокировать всех, кто хочет
    /// добавить/удалить сессию, на время чужого `Drop`.
    ///
    /// Поэтому снятые `Arc` не дропаются здесь, а складываются в
    /// `dropped`; вызывающий (`add_global_session` / `remove_global_session`)
    /// отпускает лок и только потом дропает.
    ///
    /// # Молчание при отсутствии сессии
    ///
    /// `remove_session` для несуществующего `id` — не ошибка:
    /// это может быть повторный вызов (например, `destroy` дважды).
    /// Молча выходим — идемпотентность лучше, чем паника.
    fn remove_session_inner(&mut self, id: u32, dropped: &mut Vec<Arc<SocketInner>>) {
        let Some(worker_index) = self.session_map.remove(&id) else {
            return;
        };
        let Some(worker) = self.workers.get_mut(worker_index) else {
            return;
        };

        // Сначала говорим планировщику «сессия больше не твоя» —
        // иначе следующий тик мог бы попытаться её тикнуть, уже
        // когда мы её удаляем.
        worker.manager.remove_session(id);

        // Забираем `Arc` из карты — он теперь в `dropped`, дропнется вне лока.
        if let Some(session) = worker.sessions.remove(&id) {
            dropped.push(session);
        }

        // Воркер мог стать пустым — пытаемся освободить.
        self.cleanup_empty_workers();

        // И `session_map` мог сильно просесть по размеру — возвращаем
        // память.
        self.shrink_session_map();
    }

    /// Добавляет сессию на наименее загруженный воркер с запасом места
    /// (или создаёт новый). Повторная регистрация того же `id` заменяет
    /// прежнюю сессию.
    ///
    /// # Ошибки
    /// Не удалось запустить поток воркера; сессия не зарегистрирована.
    pub fn add_session(&mut self, id: u32, session: Arc<SocketInner>) -> io::Result<Vec<Arc<SocketInner>>> {
        let mut dropped = Vec::new();

        // Повторная регистрация: удаляем старую. Это освобождает
        // место на воркере, куда пойдёт новая сессия, и снимает
        // старый `Arc` (в `dropped`).
        if self.session_map.contains_key(&id) {
            self.remove_session_inner(id, &mut dropped);
        }

        // Выбор воркера: среди тех, у кого есть место, — с минимальным
        // числом сессий. `min_by_key` при равенстве вернёт первый,
        // то есть распределение идёт «по порядку», а не случайно.
        //
        // `unwrap_or_else(|| self.create_worker())` — если все
        // заполнены, создаём нового. Замыкание нужно, потому что
        // `create_worker` берёт `&mut self`, а `iter()` уже держит
        // заимствование (хотя в `unwrap_or_else` это разрешено:
        // замыкание вызывается только когда `Option::None`, и
        // заимствование уже отпущено).
        let worker_index = self
            .workers
            .iter()
            .enumerate()
            .filter(|(_, worker)| worker.has_capacity())
            .min_by_key(|(_, worker)| worker.session_count())
            .map(|(index, _)| index)
            .unwrap_or_else(|| self.create_worker());

        let worker = &mut self.workers[worker_index];
        worker.sessions.insert(id, session.clone());

        // Регистрируем в планировщике. Если не удалось (не запустился
        // поток), откатываем всё, что успели сделать: сессию из
        // воркера, возможного пустого воркера из `workers`.
        // `session_map` не трогали — там ещё нет записи для `id`,
        // так что откатывать нечего.
        if let Err(error) = worker.manager.add_session(id, session) {
            worker.sessions.remove(&id);
            self.cleanup_empty_workers();
            return Err(error);
        }

        self.session_map.insert(id, worker_index);

        // Возвращаем `dropped` — вызывающий дропнет вне лока.
        Ok(dropped)
    }

    /// Удаляет сессию и возвращает снятые `Arc` (см. `remove_session_inner`).
    pub fn remove_session(&mut self, id: u32) -> Vec<Arc<SocketInner>> {
        let mut dropped = Vec::new();
        self.remove_session_inner(id, &mut dropped);
        dropped
    }

    /// Возвращает память `session_map` после массового удаления.
    ///
    /// `HashMap::shrink_to` — дорогая операция (перевыделение и
    /// перехеширование), поэтому вызывать её на каждое удаление
    /// бессмысленно. Здесь — эвристика:
    ///
    /// * `cap > KEEP_MIN` — не трогаем маленькие карты, там
    ///   экономия не оправдывает затрат;
    /// * `len * 4 < cap` — карта заполнена менее чем на 25%:
    ///   памяти тратится заметно больше, чем нужно.
    ///
    /// `KEEP_MIN` = 256 — минимальный размер, ниже которого
    /// `shrink_to` бессмысленен: сам overhead `HashMap` уже
    /// больше, чем сэкономленные байты.
    ///
    /// `max(KEEP_MIN)` — не даём `shrink_to` ужаться до размера
    /// меньше 256: следующее добавление сессий снова начнёт
    /// расти, и `shrink_to` окажется бессмысленным.
    fn shrink_session_map(&mut self) {
        const KEEP_MIN: usize = 256;

        let cap = self.session_map.capacity();
        if cap > KEEP_MIN && self.session_map.len() * 4 < cap {
            self.session_map.shrink_to(self.session_map.len().max(KEEP_MIN));
        }
    }
}

/// Глобальный балансировщик.
///
/// `Mutex`, потому что обновления (add/remove) сериализуются —
/// без этого `session_map` и `workers` могли бы разъехаться. Чтение
/// (тикание сессий) не идёт через этот лок: планировщики получают
/// `Arc<SocketInner>` и работают с ними не зависимо.
pub static GLOBAL_BALANCER: Lazy<Mutex<AutoBalancer>> =
    Lazy::new(|| Mutex::new(AutoBalancer::new()));

/// Регистрирует сессию в глобальном балансировщике.
pub fn add_global_session(id: u32, session: Arc<SocketInner>) -> io::Result<()> {
    let dropped = {
        let mut balancer = GLOBAL_BALANCER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        balancer.add_session(id, session)?
    };
    // Вытесненная сессия (если была) освобождается вне лока.
    drop(dropped);
    Ok(())
}

/// Удаляет сессию из глобального балансировщика.
///
/// Снятые `Arc` освобождаются после отпускания лока, чтобы тяжёлый `Drop`
/// не выполнялся под глобальным мьютексом.
///
/// # Молчание при отсутствии сессии
///
/// Как и `remove_session_inner`, не паникует и не возвращает ошибку,
/// если `id` не найден. Это делает `remove_global_session` безопасным
/// для повторного вызова — что важно, потому что `SocketBuffered::destroy`
/// идемпотентен и может вызвать `remove_global_session` дважды.
#[inline]
pub fn remove_global_session(id: u32) {
    let dropped = {
        let mut balancer = GLOBAL_BALANCER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        balancer.remove_session(id)
    };
    drop(dropped);
}