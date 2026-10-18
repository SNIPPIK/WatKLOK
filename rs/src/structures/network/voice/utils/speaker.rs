use super::heartbeat::{HeartbeatHooks, HeartbeatManager};
use parking_lot::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};

/// Значения `SpeakerType`: битовая маска поля `speaking` (op 5).
///
/// В Discord это набор флагов (`1` микрофон, `2` фейк, `4` приоритет),
/// поэтому `self_speaker` может быть произвольной комбинацией. Известные
/// значения выделены в именованные варианты, всё остальное — в `Other`.
///
/// Тип — не «чистый» enum, а обёртка над `u8`: `Other(v)` хранит маску,
/// которая не сводится к одному известному флагу. Благодаря этому
/// значения вроде `5` (микрофон + приоритет) проходят через систему,
/// не теряя информацию.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeakerType {
    /// `0` — не говорит.
    Disable,

    /// `1` — говорит (микрофон).
    Enable,

    /// `2` — фейк.
    Fake,

    /// `4` — приоритетный.
    Priority,

    /// Произвольная маска (комбинации битов).
    Other(u8)
}

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
/// Используется как интервал пульса: каждый `set_speaking` продлевает
/// ожидание, а если пакеты не отправлялись дольше этого времени, значит
/// бот перестал передавать — и статус нужно сбросить, чтобы другие
/// участники не считали его говорящим.
const KEEP_SWITCH_SPEAKING_MS: u64 = 10_000;

/// То, что спикеру нужно от голосового подключения (`this.voice` в TS).
///
/// Отдельный трейт нужен, чтобы менеджер не зависел от конкретного
/// подключения: всё, что ему требуется, — три метода.
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
/// Живёт в `Arc`, потому что на него ссылаются и голосовое подключение,
/// и пульс (для сброса статуса по тайм-ауту).
pub struct VoiceSpeakerManager {
    /// Текущий тип. `None` после `destroy()` (в TS это `null`).
    /// `Mutex` нужен, потому что менять тип может любой поток.
    ty: Mutex<Option<SpeakerType>>,

    /// Пульс, который сбрасывает статус, если долго не было обновлений.
    heartbeat: HeartbeatManager,

    /// Слабая ссылка на хост: менеджер не владеет подключением и не должен
    /// продлевать его жизнь.
    host: Weak<dyn SpeakerHost>,

    /// Флаг уничтожения: после него все методы — no-op.
    destroyed: AtomicBool
}

impl VoiceSpeakerManager {
    /// Создаёт менеджер и запускает пульс.
    ///
    /// Пульс не отправляет пакетов (`send: None`) — он используется только
    /// как таймер: если `set_speaking` не вызывался дольше
    /// `KEEP_SWITCH_SPEAKING_MS`, срабатывает `on_timeout` и статус
    /// принудительно сбрасывается в `Disable`.
    pub fn new(host: Weak<dyn SpeakerHost>) -> Arc<Self> {
        // `new_cyclic` даёт слабую ссылку на создаваемый объект — она
        // нужна замыканию тайм-аута, чтобы дотянуться до самого менеджера.
        Arc::new_cyclic(|me: &Weak<VoiceSpeakerManager>| {
            let weak_me = me.clone();
            let heartbeat = HeartbeatManager::new(HeartbeatHooks {
                // Ничего не отправляем — только ждём.
                send: None,

                // По тайм-ауту принудительно выключаем спикер.
                on_timeout: Box::new(move || {
                    if let Some(speaker) = weak_me.upgrade() {
                        speaker.set_speaking(SpeakerType::Disable);
                    }
                }),

                // Подтверждения не интересуют.
                on_ack: None
            });

            // Запускаем таймер
            heartbeat.start(Some(KEEP_SWITCH_SPEAKING_MS));

            VoiceSpeakerManager {
                // Изначально бот молчит.
                ty: Mutex::new(Some(SpeakerType::Disable)),
                heartbeat,
                host,
                destroyed: AtomicBool::new(false),
            }
        })
    }

    /// Тип по умолчанию (из конфигурации подключения).
    ///
    /// Если хост недоступен (например, подключение уже разорвано),
    /// возвращает `Enable` — безопасное значение, которое Discord примет.
    pub fn default_type(&self) -> SpeakerType {
        self.host
            .upgrade()
            .map(|h| h.default_speaker())
            .unwrap_or(SpeakerType::Enable)
    }

    /// Текущий тип спикера.
    ///
    /// `None`, если менеджер уничтожен.
    pub fn get_type(&self) -> Option<SpeakerType> {
        *self.ty.lock()
    }

    /// Задаёт тип без отправки пакета (`speaker.type = x`).
    ///
    /// Используется, когда нужно сохранить тип, но не уведомлять сервер
    /// (например, перед следующим `set_speaking`).
    pub fn set_type(&self, ty: SpeakerType) {
        *self.ty.lock() = Some(ty);
    }

    /// `speaker.speaking = x`: подтверждает пульс и, если статус
    /// изменился и WebSocket есть, отправляет пакет Speaking.
    ///
    /// Порядок действий:
    /// 1. Проверяем, что менеджер не уничтожен.
    /// 2. Подтверждаем пульс — он не должен сработать, пока мы активны.
    /// 3. Проверяем, что хост ещё доступен и у него есть WebSocket.
    /// 4. Если тип не изменился — ничего не делаем. (не спамим сервер).
    /// 5. Иначе обновляем тип и отправляем пакет.
    pub fn set_speaking(&self, speaking: SpeakerType) {
        if self.destroyed.load(Ordering::Acquire) { return; }

        // Продлеваем пульс: пока мы обновляем статус, тайм-аут не нужен.
        self.heartbeat.ack();

        let Some(host) = self.host.upgrade() else { return };

        {
            let mut ty = self.ty.lock();
            // Тип не изменился или нет соединения — отправлять нечего.
            // Сравнение по значению варианта: `Other(5) != Other(6)`,
            // `Enable != Disable` — как и ожидается.
            if *ty == Some(speaking) || !host.has_ws() {
                return;
            }
            *ty = Some(speaking);
        }

        // Отправляем пакет вне мьютекса — не блокируем других, кто мог бы
        // читать тип в этот момент.
        host.send_speaking(speaking);
    }

    /// Уничтожает менеджер: сбрасывает тип в `None`, останавливает пульс.
    ///
    /// Идемпотентно: повторный вызов ничего не делает.
    pub fn destroy(&self) {
        // swap: если уже true — выходим, второй вызов ничего не делает.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        *self.ty.lock() = None;
        // Останавливаем пульс: если он сработает после уничтожения,
        // будет пытаться достучаться до уже освобождённого хоста.
        self.heartbeat.destroy();
    }
}