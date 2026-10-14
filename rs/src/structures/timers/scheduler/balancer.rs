use crate::{
    structures::{
        network::udp::socket::SocketBuffered,
        timers::scheduler::Scheduler,
    },
};

use once_cell::sync::Lazy;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// Максимальное количество UDP-сессий, обслуживаемых одним рабочим потоком.
///
/// При превышении создаётся новый worker.
const MAX_PER_WORKER: usize = 50;

/// Worker с собственным Scheduler и набором UDP-сессий.
struct Worker {
    /// Планировщик, обслуживающий сессии worker.
    manager: Scheduler,

    /// Сессии, принадлежащие этому worker.
    sessions: HashMap<u32, Arc<SocketBuffered>>,
}

impl Worker {
    /// Создаёт пустой worker.
    fn new() -> Self {
        Self {
            manager: Scheduler::new()
                .expect("Failed to create scheduler"),
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

/// Балансировщик нагрузки между worker.
///
/// Все методы `&mut self` предполагают внешнюю синхронизацию.
pub struct AutoBalancer {
    /// Список worker'ов.
    ///
    /// При очистке может использоваться `swap_remove`, поэтому индексы
    /// могут изменяться.
    workers: Vec<Worker>,

    /// Быстрый поиск worker по `session_id`.
    session_map: HashMap<u32, usize>,
}

impl AutoBalancer {
    /// Создаёт балансировщик с одним пустым worker.
    pub fn new() -> Self {
        let mut balancer = Self {
            workers: Vec::new(),
            session_map: HashMap::new(),
        };

        balancer.create_worker();

        balancer
    }

    /// Создаёт новый worker.
    #[inline]
    fn create_worker(&mut self) -> usize {
        let index = self.workers.len();

        self.workers.push(Worker::new());

        index
    }

    /// Удаляет пустые worker'ы.
    ///
    /// Последний пустой worker сохраняется: балансировщик всегда имеет
    /// хотя бы один живой Scheduler.
    fn cleanup_empty_workers(&mut self) {
        // Не удаляем последний worker.
        while self.workers.len() > 1 {
            let empty_index = match self
                .workers
                .iter()
                .position(Worker::is_empty)
            {
                Some(index) => index,
                None => break,
            };

            let last_index = self.workers.len() - 1;

            // Сначала останавливаем scheduler удаляемого worker.
            self.workers[empty_index]
                .manager
                .shutdown();

            // Удаляем worker, перемещая последний на его место.
            self.workers.swap_remove(empty_index);

            // Если был перемещён другой worker, обновляем только его
            // session_map.
            if empty_index != last_index {
                let moved_session_ids: Vec<u32> = self.workers[empty_index]
                    .sessions
                    .keys()
                    .copied()
                    .collect();

                for session_id in moved_session_ids {
                    self.session_map.insert(
                        session_id,
                        empty_index,
                    );
                }
            }
        }
    }

    fn remove_session_inner(
        &mut self,
        id: u32,
        dropped: &mut Vec<Arc<SocketBuffered>>,
    ) {
        let Some(worker_index) = self.session_map.remove(&id) else {
            return;
        };
        let Some(worker) = self.workers.get_mut(worker_index) else {
            return;
        };

        worker.manager.remove_session(id);

        if let Some(arc) = worker.sessions.remove(&id) {
            dropped.push(arc); // ← не дропаем здесь
        }

        self.cleanup_empty_workers();
        self.shrink_session_map();
    }

    /// Добавляет или заменяет сессию.
    ///
    /// Если `id` уже существует, старая сессия сначала удаляется.
    ///
    /// Новая сессия помещается в наименее загруженный worker
    /// со свободным местом. Если свободного worker нет — создаётся новый.
    pub fn add_session(
        &mut self,
        id: u32,
        session: Arc<SocketBuffered>,
    ) -> Vec<Arc<SocketBuffered>> {
        let mut dropped = Vec::new();

        // Duplicate ID: старую сессию удаляем, но её Arc откладываем.
        if self.session_map.contains_key(&id) {
            self.remove_session_inner(id, &mut dropped);
        }

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
        worker.manager.add_session(id, session);
        self.session_map.insert(id, worker_index);

        dropped
    }

    /// Удаляет сессию.
    ///
    /// После удаления очищает пустые worker'ы.
    pub fn remove_session(&mut self, id: u32) -> Vec<Arc<SocketBuffered>> {
        let mut dropped = Vec::new();
        self.remove_session_inner(id, &mut dropped);
        dropped
    }

    /// Возвращает память `session_map`, если она заметно избыточна.
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
/// Создаётся лениво при первом обращении.
pub static GLOBAL_BALANCER: Lazy<Mutex<AutoBalancer>> =
    Lazy::new(|| Mutex::new(AutoBalancer::new()));

/// Добавляет сессию в балансировщике.
#[inline]
pub fn add_global_session(
    id: u32,
    session: SocketBuffered,
) {
    let mut balancer = GLOBAL_BALANCER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    balancer.add_session(
        id,
        Arc::new(session),
    );
}

/// Удаляет сессию из глобального балансировщика.
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