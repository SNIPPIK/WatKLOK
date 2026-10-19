use crate::structures::network::ws::runtime;
use crate::utils::duration::now_ms;
use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Weak,
    },
    time::Duration,
};
use tokio::{sync::Notify, task::JoinHandle};

/// Значения `SpeakerType`: битовая маска поля `speaking` (op 5).
///
/// В Discord это набор флагов (`1` микрофон, `2` фейк, `4` приоритет),
/// поэтому `self_speaker` может быть произвольной комбинацией. Известные
/// значения выделены в именованные варианты, всё остальное — в `Other`.
///
/// Равенство определяется **по битам**, а не по варианту: `Other(1)`
/// равен `Enable`, `Other(0)` равен `Disable`. Иначе дедупликация
/// в `set_speaking` пропускала бы лишние пакеты.
#[derive(Clone, Copy, Debug)]
pub enum SpeakerType {
    /// `0` — не говорит.
    Disable,

    /// `1` — говорит (микрофон).
    Enable,

    /// `2` — фейк (soundshare).
    Fake,

    /// `4` — приоритетный.
    Priority,

    /// Произвольная маска (комбинации битов).
    Other(u8)
}

/// Сравнение по значению битовой маски, а не по варианту.
///
/// Это принципиально для `set_speaking`: там сравнивается текущий тип
/// с новым, чтобы не отправлять лишний пакет. Если бы `Other(1)` не был
/// равен `Enable`, мы бы отправляли Speaking каждый раз при смене
/// представления одного и того же значения.
impl PartialEq for SpeakerType {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.bits() == other.bits()
    }
}

// `Eq` — потому что `bits()` возвращает `u8`, а `u8` — `Eq`.
// Без этого `SpeakerType` нельзя использовать в `HashSet` и т.п.
impl Eq for SpeakerType {}

impl SpeakerType {
    /// Числовое значение маски.
    ///
    /// Возвращает `u8`, чтобы можно было отправить в JSON как есть
    /// и не заниматься приведением на каждом шаге.
    pub const fn bits(self) -> u8 {
        match self {
            Self::Disable => 0,
            Self::Enable => 1,
            Self::Fake => 2,
            Self::Priority => 4,
            Self::Other(v) => v
        }
    }

    /// Из числового значения.
    ///
    /// Известные маски (0, 1, 2, 4) превращаются в именованные варианты,
    /// всё остальное (включая комбинации вроде 3 или 5) — в `Other`.
    /// `Other(0)` отсюда получить нельзя: 0 всегда станет `Disable`.
    pub const fn from_bits(bits: u8) -> Self {
        match bits {
            0 => Self::Disable,
            1 => Self::Enable,
            2 => Self::Fake,
            4 => Self::Priority,
            other => Self::Other(other)
        }
    }
}

/// Преобразование из сырого значения битовой маски в `SpeakerType`.
///
/// Нужно, чтобы значения из JSON, нативных вызовов и старых мест кода,
/// где ещё используется `u8`, автоматически приводились к новому типу
/// через `Into`. Без этого пришлось бы везде писать
/// `SpeakerType::from_bits(x)` вручную — шумно и легко забыть.
///
/// Делегирует в `from_bits`, поэтому известные значения (0, 1, 2, 4)
/// получат именованные варианты, а всё остальное — `Other`. Это значит,
/// что `SpeakerType::from(5u8)` вернёт `SpeakerType::Other(5)`,
/// а не какой-то другой вариант.
///
/// # Пример
///
/// ```ignore
/// let t: SpeakerType = 1u8.into();
/// assert_eq!(t, SpeakerType::Enable);
///
/// let t: SpeakerType = 5u8.into();
/// assert_eq!(t, SpeakerType::Other(5));
/// ```
impl From<u8> for SpeakerType {
    #[inline]
    fn from(bits: u8) -> Self {
        // Делегируем в `from_bits` — вся логика разбора живёт там,
        // здесь только адаптер для `Into`/`From`.
        Self::from_bits(bits)
    }
}

/// Преобразование из `SpeakerType` в сырое значение битовой маски.
///
/// Нужно на границе с JSON: пакет Speaking содержит `speaking: u8`,
/// и при сериализации в `serde_json::Value` мы должны отдать число,
/// а не структуру. `impl From` позволяет написать `u8::from(t)`
/// или `t.into()` в местах, где нужен `u8`.
///
/// Работает и для `Other(v)`: возвращает `v` без изменений. То есть
/// `SpeakerType::Other(5).into()` даст `5u8`, и при последующем
/// `SpeakerType::from(5u8)` мы снова получим `Other(5)` — преобразование
/// туда и обратно не теряет информацию.
///
/// # Пример
///
/// ```ignore
/// assert_eq!(u8::from(SpeakerType::Enable), 1);
/// assert_eq!(u8::from(SpeakerType::Other(5)), 5);
/// ```
impl From<SpeakerType> for u8 {
    #[inline]
    fn from(t: SpeakerType) -> Self {
        // `bits()` уже знает, как превратить любой вариант в число.
        // Здесь только адаптер для `Into`/`From`.
        t.bits()
    }
}

/// Время (мс), по истечении которого статус сбрасывается в `Disable`,
/// если не было вызовов `set_speaking`.
///
/// Используется как дедлайн: каждый `set_speaking` продлевает ожидание,
/// а если пакеты не отправлялись дольше этого времени, значит бот
/// перестал передавать — и статус нужно сбросить, чтобы другие
/// участники не считали его говорящим.
const KEEP_SWITCH_SPEAKING_MS: u64 = 10_000;

/// То, что спикеру нужно от голосового подключения (`this.voice` в TS).
///
/// **Важно:** `send_speaking` вызывается под внутренним мьютексом
/// менеджера (это гарантирует порядок пакетов). Реализация не должна
/// вызывать методы `VoiceSpeakerManager` синхронно — будет взаимная
/// блокировка. Метод должен быть быстрым (например, класть пакет в очередь).
pub trait SpeakerHost: Send + Sync {
    /// Тип по умолчанию — `voice.configuration.self_speaker` или `Enable`.
    /// Используется, когда бот начинает передавать без явно заданного типа.
    fn default_speaker(&self) -> SpeakerType;

    /// `true`, если WebSocket-соединение с голосовым сервером установлено.
    /// Без соединения отправлять пакет Speaking некуда.
    fn has_ws(&self) -> bool;

    /// Отправляет в WebSocket пакет
    /// `{ op: 5, d: { speaking, delay: 0, ssrc }, seq }`.
    fn send_speaking(&self, speaking: SpeakerType);
}

/// Менеджер статуса «говорит / молчит».
///
/// Вместо heartbeat используется один «сторож» с ленивым дедлайном:
/// `set_speaking` только пишет одно атомарное значение (без локов и
/// аллокаций), а сторож спит до дедлайна и полностью засыпает, пока
/// статус `Disable`.
pub struct VoiceSpeakerManager {
    /// Текущий тип. `None` — менеджер уничтожен (это же признак
    /// уничтожения: проверка и изменение идут под одним локом).
    ty: Mutex<Option<SpeakerType>>,

    /// Время последнего `set_speaking` (мс от эпохи).
    /// Атомарное поле, чтобы `set_speaking` мог продлевать дедлайн
    /// без захвата мьютекса `ty` на каждом вызове.
    last_set: AtomicU64,

    /// Будит сторожа, когда статус стал не-`Disable`.
    /// Без этого сторож спал бы до дедлайна, даже если статус
    /// только что сменился на «говорит» и нужно пересчитать время.
    wake: Arc<Notify>,

    /// Задача-сторож. Хранится, чтобы прервать её в `destroy`/`Drop`.
    watchdog: Mutex<Option<JoinHandle<()>>>,

    /// Слабая ссылка на хост: менеджер не владеет подключением.
    /// Иначе получился бы цикл владения: менеджер → хост → менеджер.
    host: Weak<dyn SpeakerHost>
}

impl VoiceSpeakerManager {
    /// Создаёт менеджер и запускает сторожа.
    ///
    /// Должен вызываться из контекста, где работает `runtime::spawn`
    /// (иначе паника при запуске задачи).
    pub fn new(host: Weak<dyn SpeakerHost>) -> Arc<Self> {
        let this = Arc::new(Self {
            // Изначально бот молчит.
            ty: Mutex::new(Some(SpeakerType::Disable)),
            last_set: AtomicU64::new(now_ms()),
            wake: Arc::new(Notify::new()),
            watchdog: Mutex::new(None),
            host
        });

        // Задачу запускаем ПОСЛЕ создания `Arc`: внутри `new_cyclic`
        // `Weak::upgrade` ещё возвращает `None`, и сторож завершился бы сразу.
        // `Arc::downgrade(&this)` — слабая ссылка для сторожа, чтобы он
        // не продлевал жизнь менеджеру.
        let handle = runtime::spawn(Self::watchdog(Arc::downgrade(&this), this.wake.clone()));
        *this.watchdog.lock() = Some(handle);
        this
    }

    /// Сторож: сбрасывает статус в `Disable` через `KEEP_SWITCH_SPEAKING_MS`
    /// после последнего `set_speaking`. Пока статус `Disable` — не просыпается.
    ///
    /// # Логика
    ///
    /// 1. Если менеджер уничтожен — выходим.
    /// 2. Если статус `Disable` — спим на `wake.notified()`, пока нас
    ///    не разбудят. Никаких таймеров, пока бот молчит.
    /// 3. Если статус не-`Disable` — считаем дедлайн:
    ///    * дедлайн прошёл — сбрасываем в `Disable`, перечитываем
    ///      состояние (могли уничтожить);
    ///    * дедлайн не прошёл — спим до него.
    async fn watchdog(weak: Weak<Self>, wake: Arc<Notify>) {
        loop {
            // Сильную ссылку держим только внутри блока — не через `await`,
            // иначе сторож продлевал бы жизнь менеджеру.
            let sleep_ms = {
                let Some(this) = weak.upgrade() else { break };
                match this.get_type() {
                    // Уничтожен — выходим.
                    None => break,

                    // Молчит — ждём пробуждения, без таймера.
                    Some(SpeakerType::Disable) => None,

                    // Говорит — считаем дедлайн.
                    Some(_) => {
                        let deadline = this
                            .last_set
                            .load(Ordering::Relaxed)
                            .saturating_add(KEEP_SWITCH_SPEAKING_MS);
                        let now = now_ms();

                        if now >= deadline {
                            // Дедлайн прошёл — пытаемся сбросить в `Disable`.
                            // `apply` может не сработать, если нет WS или
                            // если уже `Disable` (например, гонка с
                            // другим `set_speaking`).
                            this.apply(SpeakerType::Disable);
                            match this.get_type() {
                                // Сбросили (или уничтожены) — перечитаем
                                // состояние в начале следующей итерации.
                                None | Some(SpeakerType::Disable) => continue,

                                // Не вышло (например, нет WS) — повторим
                                // через полный интервал. Не спамим попытками.
                                Some(_) => Some(KEEP_SWITCH_SPEAKING_MS),
                            }
                        } else {
                            // Дедлайн ещё не прошёл — спим до него.
                            Some(deadline - now)
                        }
                    }
                }
            };

            match sleep_ms {
                // Спим до пробуждения: нас разбудят, когда статус
                // сменится с `Disable` на что-то другое.
                None => wake.notified().await,

                // Спим до дедлайна. После пробуждения пересчитаем
                // состояние (могло измениться).
                Some(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
            }
        }
    }

    /// Тип по умолчанию (из конфигурации подключения).
    ///
    /// Если хост недоступен, возвращает `Enable` — безопасное значение,
    /// которое Discord примет.
    pub fn default_type(&self) -> SpeakerType {
        self.host
            .upgrade()
            .map(|h| h.default_speaker())
            .unwrap_or(SpeakerType::Enable)
    }

    /// Текущий тип спикера. `None`, если менеджер уничтожен.
    pub fn get_type(&self) -> Option<SpeakerType> {
        *self.ty.lock()
    }

    /// Задаёт тип без отправки пакета (`speaker.type = x`).
    ///
    /// На уничтоженном менеджере — no-op (иначе `destroy` «воскресал» бы).
    /// Проверка `slot.is_some()` — это и есть проверка «не уничтожен»:
    /// `destroy` выставляет `None`.
    pub fn set_type(&self, ty: SpeakerType) {
        let mut slot = self.ty.lock();
        if slot.is_some() {
            *slot = Some(ty);
        }
    }

    /// `speaker.speaking = x`: продлевает дедлайн и, если статус
    /// изменился и WebSocket есть, отправляет пакет Speaking.
    ///
    /// Порядок действий:
    /// 1. Проверяем, что менеджер не уничтожен (внутри `apply`).
    /// 2. Подтверждаем пульс — он не должен сработать, пока мы активны.
    /// 3. Проверяем, что хост ещё доступен и у него есть WebSocket.
    /// 4. Если тип не изменился — ничего не делаем (не спамим сервер).
    /// 5. Иначе обновляем тип и отправляем пакет.
    pub fn set_speaking(&self, speaking: SpeakerType) {
        // Продлеваем дедлайн: один атомарный store, без локов.
        // Это самая горячая часть — никаких мьютексов.
        self.last_set.store(now_ms(), Ordering::Relaxed);

        if !self.apply(speaking) {
            return;
        }

        // Будим сторожа ПОСЛЕ применения: иначе он мог бы проснуться,
        // увидеть ещё `Disable` и уснуть, потеряв пробуждение.
        // Будим только при переходе в «говорит»: при переходе в `Disable`
        // сторож и так знает, что делать (он спит на `notified()`
        // и не будет разбужен, что правильно).
        if speaking.bits() != 0 {
            self.wake.notify_one();
        }
    }

    /// Применяет тип: проверка «уничтожен», дедупликация, смена типа и
    /// отправка пакета выполняются под ОДНИМ локом — так пакеты уходят
    /// в том же порядке, в каком менялся тип, и после `destroy` ничего
    /// не отправляется.
    ///
    /// Возвращает `false`, если менеджер уничтожен.
    fn apply(&self, speaking: SpeakerType) -> bool {
        let mut ty = self.ty.lock();
        // Менеджер уничтожен — выходим. `None` выставляется в `destroy`
        // и проверяется здесь.
        let Some(current) = *ty else { return false };

        // Хост недоступен (подключение уже разорвано) — считаем,
        // что «применено», чтобы `set_speaking` не пытался будить сторожа.
        let Some(host) = self.host.upgrade() else { return true };

        // Тип не изменился или нет соединения — отправлять нечего.
        // Сравнение по битам (см. `PartialEq`): `Other(1) == Enable`.
        if current == speaking || !host.has_ws() {
            return true;
        }

        // Обновляем тип и отправляем пакет под одним локом:
        // гарантирует, что пакеты уходят в том же порядке, в каком
        // менялся тип. `send_speaking` должен быть быстрым —
        // см. doc-комментарий к `SpeakerHost`.
        *ty = Some(speaking);
        host.send_speaking(speaking);
        true
    }

    /// Уничтожает менеджер: сбрасывает тип в `None`, останавливает сторожа.
    ///
    /// Идемпотентно.
    pub fn destroy(&self) {
        {
            let mut ty = self.ty.lock();
            // Уже уничтожен — выходим.
            if ty.is_none() {
                return;
            }
            *ty = None;
        }

        // Останавливаем сторожа. `abort` не блокирует — просто помечает
        // задачу как отменённую; следующая точка ожидания завершит её.
        if let Some(task) = self.watchdog.lock().take() {
            task.abort();
        }
    }
}

impl Drop for VoiceSpeakerManager {
    fn drop(&mut self) {
        // Сторож может спать на `notified()` бесконечно — прерываем явно.
        // `get_mut()` вместо `lock()` — потому что в `Drop` нет других
        // владельцев, и мьютекс не нужен.
        if let Some(task) = self.watchdog.get_mut().take() {
            task.abort();
        }
    }
}