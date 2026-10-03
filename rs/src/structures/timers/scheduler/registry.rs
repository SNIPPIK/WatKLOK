use crate::structures::network::udp::socket::SocketBuffered;
use arc_swap::ArcSwap;
use std::collections::HashMap;
use std::sync::Arc;

/// Реестр активных UDP-сессий.
///
/// Хранит карту `id → Arc<SocketBuffered>` и обеспечивает lock-free
/// чтение снимка через `ArcSwap`. Обновления выполняются копированием
/// карты и атомарной заменой, что позволяет читателям получать
/// согласованный снимок без блокировок.
pub struct SessionRegistry {
    /// Карта сессий, обёрнутая в `ArcSwap` для lock-free снимков.
    sessions: ArcSwap<HashMap<u32, Arc<SocketBuffered>>>,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    /// Создаёт пустой реестр.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: ArcSwap::from_pointee(HashMap::new()),
        }
    }

    /// Добавляет сессию в реестр (или заменяет существующую с тем же id).
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
    #[inline]
    pub fn add(&self, id: u32, session: Arc<SocketBuffered>) {
        self.update(|map| {
            // FnMut (rcu может перезапустить замыкание) — владение
            // сессией отдавать нельзя, клонируем Arc.
            map.insert(id, Arc::clone(&session));
        });
    }

    /// Удаляет сессию по идентификатору.
    ///
    /// Если сессии с таким id нет — операция не выполняет действий.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    #[inline]
    pub fn remove(&self, id: u32) {
        self.update(|map| {
            map.remove(&id);
        });
    }

    /// Проверяет, что реестр не содержит ни одной сессии.
    #[must_use]
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.sessions.load().is_empty()
    }

    /// Количество зарегистрированных сессий (snapshot; может устареть сразу
    /// после возврата при конкурентных обновлениях).
    #[must_use]
    #[inline]
    pub fn len(&self) -> usize {
        self.sessions.load().len()
    }

    /// Возвращает снимок карты сессий.
    ///
    /// Снимок отражает состояние на момент вызова и не изменяется
    /// при последующих обновлениях реестра.
    #[must_use]
    #[inline]
    pub fn snapshot(&self) -> Arc<HashMap<u32, Arc<SocketBuffered>>> {
        self.sessions.load_full()
    }

    /// Применяет замыкание к копии текущей карты и атомарно публикует результат.
    ///
    /// Используется `ArcSwap::rcu`: если между чтением и публикацией другой
    /// поток успел обновить реестр, замыкание применяется заново к свежей
    /// карте. Прежняя схема `load_full` + `store` теряла конкурентные
    /// обновления: потерянный `remove` оставлял сессию в реестре навсегда
    /// (её `Arc<SocketBuffered>` держался и тикал до конца процесса).
    ///
    /// Карта копируется на каждое обновление всегда: `ArcSwap` сам держит
    /// ссылку на текущую версию, поэтому `Arc::make_mut` из прежнего кода
    /// копировал карту в любом случае — «дешёвого пути без копии» не было.
    ///
    /// # Аргументы
    /// * `update_fn` — замыкание, изменяющее карту (может вызываться повторно).
    #[inline]
    fn update<F>(&self, mut update_fn: F) where
        F: FnMut(&mut HashMap<u32, Arc<SocketBuffered>>),
    {
        self.sessions.rcu(|current| {
            let mut map: HashMap<u32, Arc<SocketBuffered>> = (**current).clone();
            update_fn(&mut map);
            Arc::new(map)
        });
    }
}