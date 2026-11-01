use crate::structures::network::udp::inner_socket::SocketInner;
use {
    std::{collections::HashMap, sync::Arc},
    arc_swap::ArcSwap
};

type SessionMap = HashMap<u32, Arc<SocketInner>>;

/// Реестр сессий одного воркера.
///
/// Воркер читает снимок карты без блокировок (`ArcSwap`), а изменения
/// (редкие: подключение и отключение сессий) копируют карту и публикуют её
/// атомарно через `rcu`.
pub struct SessionRegistry {
    sessions: ArcSwap<SessionMap>,
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

    /// Добавляет сессию (или заменяет существующую с тем же `id`).
    pub fn add(&self, id: u32, session: Arc<SocketInner>) {
        // `rcu` может повторить замыкание при конкурентном обновлении,
        // поэтому владение сессией отдавать нельзя — клонируем `Arc`.
        self.update(|map| {
            map.insert(id, Arc::clone(&session));
        });
    }

    /// Удаляет сессию и возвращает её (`None`, если такой не было).
    pub fn remove(&self, id: u32) -> Option<Arc<SocketInner>> {
        let mut removed = None;
        self.update(|map| {
            removed = map.remove(&id);
        });
        removed
    }

    /// Возвращает сессию по `id`.
    #[must_use]
    pub fn get(&self, id: u32) -> Option<Arc<SocketInner>> {
        self.sessions.load().get(&id).cloned()
    }

    /// Количество сессий.
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.load().len()
    }

    /// `true`, если сессий нет.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.load().is_empty()
    }

    /// Снимок карты: не меняется при последующих обновлениях реестра.
    #[must_use]
    pub fn snapshot(&self) -> Arc<SessionMap> {
        self.sessions.load_full()
    }

    /// Применяет замыкание к копии карты и атомарно публикует результат.
    ///
    /// Именно `rcu`, а не `load` + `store`: иначе конкурентное обновление
    /// терялось бы, и потерянный `remove` оставлял бы сессию в реестре
    /// навсегда.
    fn update<F>(&self, mut update_fn: F)
    where
        F: FnMut(&mut SessionMap),
    {
        self.sessions.rcu(|current| {
            let mut map: SessionMap = (**current).clone();
            update_fn(&mut map);
            Arc::new(map)
        });
    }
}
