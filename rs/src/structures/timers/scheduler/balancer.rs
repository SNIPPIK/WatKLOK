use crate::structures::{
    network::udp::inner_socket::SocketInner,
    timers::scheduler::{constants::*, Scheduler},
};
use std::{
    collections::HashMap,
    io,
    sync::{Arc, LazyLock, Mutex, TryLockError},
};

/// Нагрузка воркера, нс: измеренная стоимость тика или оценка по числу
/// сессий (что больше). Оценка нужна, пока измерения свежих сессий не
/// накопились: иначе много новых сессий разом попали бы на один воркер.
fn load(worker: &Scheduler) -> u64 {
    let estimated = worker.session_count() as u64 * SESSION_COST_ESTIMATE_NS;
    worker.cost_ns().max(estimated)
}

/// Есть ли у воркера запас: и по числу сессий, и по нагрузке «после
/// добавления ещё одной сессии».
fn has_room(worker: &Scheduler) -> bool {
    worker.session_count() < MAX_SESSIONS_PER_WORKER
        && load(worker) + SESSION_COST_ESTIMATE_NS < OVERLOAD_THRESHOLD_NS
}

/// Балансировщик: список воркеров и индекс `session_id -> worker_id`.
pub struct AutoBalancer {
    workers: Vec<Scheduler>,

    /// Хранит `worker_id`, а не индекс: индексы сдвигаются при `swap_remove`,
    /// идентификаторы — нет.
    session_map: HashMap<u32, u64>,

    /// Следующий идентификатор воркера. Монотонный и не переиспользуется,
    /// чтобы сессия, привязанная к удалённому воркеру, не «прилипла» к
    /// новому с тем же id.
    next_worker_id: u64,
}

/// Исход выноса сессии на другой воркер.
enum OffloadOutcome {
    /// Сессия перенесена на целевой воркер.
    Moved,
    /// Перенос не состоялся: сессия уже уехала/удалена, на источнике
    /// осталась бы одна сессия, или целевой воркер не найден.
    Noop,
    /// Оба воркера отвергли сессию; она удалена из балансировщика.
    /// `Arc` возвращается для дропа вне глобального лока.
    Orphaned(Arc<SocketInner>),
}

impl Default for AutoBalancer {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoBalancer {
    /// Создаёт балансировщик с одним (ещё без потока) воркером.
    pub fn new() -> Self {
        let mut balancer = Self {
            workers: Vec::new(),
            session_map: HashMap::new(),
            next_worker_id: 1,
        };
        balancer.create_worker();
        balancer
    }

    /// Добавляет воркера в конец списка и возвращает его индекс.
    fn create_worker(&mut self) -> usize {
        let id = self.next_worker_id;
        self.next_worker_id += 1;

        self.workers.push(Scheduler::new(id));
        self.workers.len() - 1
    }

    /// Индекс воркера по стабильному id. Воркеров единицы-десятки,
    /// линейный поиск дешевле отдельной карты.
    fn index_of(&self, worker_id: u64) -> Option<usize> {
        self.workers.iter().position(|w| w.id() == worker_id)
    }

    /// Индекс наименее загруженного воркера с запасом (кроме `exclude`) или
    /// нового воркера, если запаса нет нигде. При равной нагрузке выигрывает
    /// воркер с меньшим числом сессий.
    fn pick_worker(&mut self, exclude: Option<u64>) -> usize {
        let best = self
            .workers
            .iter()
            .enumerate()
            .filter(|(_, w)| Some(w.id()) != exclude && has_room(w))
            .min_by_key(|(_, w)| (load(w), w.session_count()))
            .map(|(index, _)| index);

        best.unwrap_or_else(|| self.create_worker())
    }

    /// Удаляет пустые воркеры, оставляя хотя бы один. Поток удаляемого
    /// воркера останавливается в его `Drop`. `session_map` хранит
    /// идентификаторы, поэтому после удаления остаётся валидной.
    fn cleanup_empty_workers(&mut self) {
        while self.workers.len() > 1 {
            let Some(index) = self.workers.iter().position(|w| w.session_count() == 0)
            else {
                break;
            };

            drop(self.workers.swap_remove(index));
        }
    }

    /// Удаляет сессию. Снятые `Arc` кладутся в `dropped`: вызывающий
    /// освобождает их уже вне глобального лока.
    fn remove_session_inner(&mut self, id: u32, dropped: &mut Vec<Arc<SocketInner>>) {
        let Some(worker_id) = self.session_map.remove(&id) else {
            return;
        };
        let Some(index) = self.index_of(worker_id) else {
            return;
        };

        if let Some(session) = self.workers[index].remove_session(id) {
            dropped.push(session);
        }

        self.cleanup_empty_workers();
        self.shrink_session_map();
    }

    /// Добавляет сессию на наименее загруженный воркер. Повторная регистрация
    /// того же `id` заменяет прежнюю сессию.
    ///
    /// # Ошибки
    /// Не удалось запустить поток воркера; сессия не зарегистрирована.
    pub fn add_session(
        &mut self,
        id: u32,
        session: Arc<SocketInner>,
    ) -> io::Result<Vec<Arc<SocketInner>>> {
        let mut dropped = Vec::new();

        if self.session_map.contains_key(&id) {
            self.remove_session_inner(id, &mut dropped);
        }

        let index = self.pick_worker(None);
        let worker_id = self.workers[index].id();

        // При ошибке `Scheduler::add_session` сам убирает сессию из реестра.
        if let Err(error) = self.workers[index].add_session(id, session) {
            self.cleanup_empty_workers();
            return Err(error);
        }

        self.session_map.insert(id, worker_id);
        Ok(dropped)
    }

    /// Удаляет сессию и возвращает снятые `Arc` (см. `remove_session_inner`).
    pub fn remove_session(&mut self, id: u32) -> Vec<Arc<SocketInner>> {
        let mut dropped = Vec::new();
        self.remove_session_inner(id, &mut dropped);
        dropped
    }

    /// Переносит сессию с перегруженного воркера на другой.
    ///
    /// Сначала сессию принимает новый воркер (`attach` атомарно меняет
    /// владельца), затем прежний её отпускает. Старый воркер после смены
    /// владельца сразу перестаёт её трогать, поэтому окна, в котором сессия
    /// без воркера или обрабатывается двумя сразу, нет.
    fn offload(&mut self, from_id: u64, id: u32) -> OffloadOutcome {          // <-- сигнатура
        if self.session_map.get(&id) != Some(&from_id) {
            return OffloadOutcome::Noop;                                      // <-- было None
        }
        let Some(from_index) = self.index_of(from_id) else {                  // <-- было ? на Option
            return OffloadOutcome::Noop;
        };
        if self.workers[from_index].session_count() <= 1 {
            return OffloadOutcome::Noop;                                      // <-- было None
        }
        let Some(session) = self.workers[from_index].session(id) else {       // <-- было ? на Option
            return OffloadOutcome::Noop;
        };

        let target_index = self.pick_worker(Some(from_id));
        let target_id = self.workers[target_index].id();

        match self.workers[target_index].add_session(id, Arc::clone(&session)) {
            Ok(()) => {
                self.session_map.insert(id, target_id);
                let _ = self.workers[from_index].remove_session(id);
                OffloadOutcome::Moved                                         // <-- было None
            }

            Err(target_error) => {
                match self.workers[from_index].add_session(id, session) {
                    Ok(()) => {
                        self.cleanup_empty_workers();
                        OffloadOutcome::Noop                                  // <-- было None
                    }

                    Err(restore_error) => {
                        eprintln!( /* без изменений */ );
                        self.session_map.remove(&id);
                        let orphan = self.workers[from_index].remove_session(id);
                        self.cleanup_empty_workers();
                        // <-- было `orphan`; `Option → enum`
                        orphan.map_or(OffloadOutcome::Noop, OffloadOutcome::Orphaned)
                    }
                }
            }
        }
    }

    /// Возвращает память `session_map` после массового удаления: сжатие
    /// дорого, поэтому только при заполнении < 25% и не ниже `KEEP_MIN`.
    fn shrink_session_map(&mut self) {
        const KEEP_MIN: usize = 256;

        let cap = self.session_map.capacity();
        if cap > KEEP_MIN && self.session_map.len() * 4 < cap {
            self.session_map
                .shrink_to(self.session_map.len().max(KEEP_MIN));
        }
    }
}

/// Глобальный балансировщик. Отравление мьютекса игнорируется: состояние
/// балансировщика остаётся согласованным после паники вызывающего.
pub static GLOBAL_BALANCER: LazyLock<Mutex<AutoBalancer>> =
    LazyLock::new(|| Mutex::new(AutoBalancer::new()));

/// Регистрирует сессию в глобальном балансировщике.
///
/// # Ошибки
/// Не удалось запустить поток планировщика.
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

/// Удаляет сессию из глобального балансировщика; снятые `Arc`
/// освобождаются после отпускания лока.
pub fn remove_global_session(id: u32) {
    let dropped = {
        let mut balancer = GLOBAL_BALANCER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        balancer.remove_session(id)
    };
    drop(dropped);
}

/// Просьба перегруженного воркера вынести сессию на другой воркер.
///
/// Возвращает `true` **только** если сессия действительно переехала на
/// целевой воркер. `false` — не было выноса: балансировщик занят, сессия
/// уже уехала/удалена, на источнике одна сессия, либо оба воркера
/// отвергли сессию.
///
/// Вызывается из потока воркера, поэтому НИКОГДА не блокируется: если
/// балансировщик занят, просьба пропускается и повторится на одном из
/// следующих перегруженных тиков.
pub fn offload_session(from_worker: u64, id: u32) -> bool {
    let outcome = {
        let mut balancer = match GLOBAL_BALANCER.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return false,
        };
        balancer.offload(from_worker, id)
    };

    match outcome {
        OffloadOutcome::Moved => true,
        OffloadOutcome::Noop => false,
        // Orphan-сессию дропаем вне глобального лока, как и раньше.
        OffloadOutcome::Orphaned(session) => {
            drop(session);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::UdpSocket;

    fn session() -> Arc<SocketInner> {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        Arc::new(SocketInner::new(socket))
    }

    #[test]
    fn new_balancer_has_one_worker_with_room() {
        let balancer = AutoBalancer::new();
        assert_eq!(balancer.workers.len(), 1);
        assert!(has_room(&balancer.workers[0]));
    }

    #[test]
    fn worker_ids_are_stable_and_unique() {
        let mut balancer = AutoBalancer::new();
        let second = balancer.create_worker();
        let third = balancer.create_worker();

        let ids: Vec<u64> = balancer.workers.iter().map(Scheduler::id).collect();
        assert_eq!(ids, vec![1, 2, 3]);
        assert_eq!(balancer.workers[second].id(), 2);
        assert_eq!(balancer.workers[third].id(), 3);
    }

    #[test]
    fn cleanup_keeps_one_worker_and_ids_do_not_change() {
        let mut balancer = AutoBalancer::new();
        balancer.create_worker();
        balancer.create_worker();

        balancer.cleanup_empty_workers();
        assert_eq!(balancer.workers.len(), 1);

        // Новый воркер не получает идентификатор удалённого.
        let index = balancer.create_worker();
        assert!(balancer.workers[index].id() > 3);
    }

    #[test]
    fn add_and_remove_session_roundtrip() {
        let mut balancer = AutoBalancer::new();
        balancer.add_session(1, session()).unwrap();
        assert_eq!(balancer.session_map.len(), 1);
        assert_eq!(balancer.workers[0].session_count(), 1);

        let dropped = balancer.remove_session(1);
        assert_eq!(dropped.len(), 1);
        assert!(balancer.session_map.is_empty());
        assert_eq!(balancer.workers[0].session_count(), 0);
    }

    #[test]
    fn re_adding_same_id_replaces_previous_session() {
        let mut balancer = AutoBalancer::new();
        balancer.add_session(7, session()).unwrap();

        let dropped = balancer.add_session(7, session()).unwrap();
        assert_eq!(dropped.len(), 1, "прежняя сессия возвращается для дропа вне лока");
        assert_eq!(balancer.session_map.len(), 1);
    }

    #[test]
    fn offload_moves_session_to_another_worker() {
        let mut balancer = AutoBalancer::new();
        balancer.add_session(1, session()).unwrap();
        balancer.add_session(2, session()).unwrap();

        let from_id = balancer.workers[0].id();
        assert_eq!(balancer.workers[0].session_count(), 2);

        let outcome = balancer.offload(from_id, 1);
        assert!(matches!(outcome, OffloadOutcome::Moved));

        let new_worker = balancer.session_map[&1];
        assert_ne!(new_worker, from_id);
        assert_eq!(balancer.workers[0].session_count(), 1);
        assert!(balancer.workers.iter().any(|w| w.id() == new_worker));
    }

    #[test]
    fn offload_never_empties_the_source_worker() {
        let mut balancer = AutoBalancer::new();
        balancer.add_session(1, session()).unwrap();

        let from_id = balancer.workers[0].id();
        let outcome = balancer.offload(from_id, 1);
        assert!(matches!(outcome, OffloadOutcome::Noop));
        assert_eq!(balancer.session_map[&1], from_id);
    }
}
