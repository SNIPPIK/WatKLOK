use crate::structures::crypto::mls::results::{
    MlsError, PendingTransition, ProposalsResult, Result, TransitionResult
};
use std::{
    collections::HashMap,
    num::NonZeroU16,
    time::{
        Duration, Instant
    }
};

/// Время (сек) до автоматического истечения passthrough после перехода.
const TRANSITION_EXPIRY: u32 = 10;

/// Увеличенный срок passthrough при ожидании понижения версии.
const TRANSITION_EXPIRY_PENDING_DOWNGRADE: u32 = 24;

/// Тайм-аут ожидания перехода: если `execute_transition` не вызван
/// за это время, запись о нём удаляется.
const TRANSITION_TIMEOUT: Duration = Duration::from_secs(5);

/// Обёртка над `davey::DaveSession`: состояние E2EE-сессии и переходов.
///
/// Управляет E2EE-состоянием голосового канала: обмен ключами, переходы
/// между версиями протокола, обработка proposals/commit/welcome, шифрование
/// Opus-пакетов. Нативная сессия создаётся лениво при первой инициализации.
pub struct MlsSession {
    /// Текущая версия протокола.
    version: u16,

    /// Идентификатор пользователя (строка до парсинга).
    user_id: String,

    /// Идентификатор канала (строка до парсинга).
    channel_id: String,

    /// Нативная сессия. `None` до первой инициализации.
    inner: Option<davey::DaveSession>,

    /// Флаг уничтожения.
    destroyed: bool,

    /// Флаг повторной инициализации (после ошибки перехода или при epoch).
    reinitializing: bool,

    /// Флаг выполнения перехода в текущий момент.
    is_transitioning: bool,

    /// Флаг понижения версии (переход с ненулевой на 0).
    downgraded: bool,

    /// Идентификатор последнего успешного перехода.
    last_transition_id: Option<u16>,

    /// Ожидаемые переходы: id → запись о переходе.
    pending_transitions: HashMap<u16, PendingTransition>,

    /// External sender, отложенный до создания нативной сессии.
    pending_external_sender: Option<Vec<u8>>
}

impl MlsSession {
    /// Создаёт обёртку без нативной сессии.
    ///
    /// # Аргументы
    /// * `version` — начальная версия протокола.
    /// * `user_id` — идентификатор пользователя.
    /// * `channel_id` — идентификатор канала.
    pub fn new(version: u16, user_id: String, channel_id: String) -> Self {
        Self {
            version,
            user_id,
            channel_id,

            // Нативная сессия ещё не создана.
            inner: None,

            destroyed: false,
            reinitializing: false,
            is_transitioning: false,
            downgraded: false,

            last_transition_id: None,
            pending_transitions: HashMap::new(),
            pending_external_sender: None
        }
    }

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// `true`, если сессия уничтожена.
    ///
    /// Устанавливается в `destroy()` и остаётся `true` до конца жизни объекта.
    #[inline]
    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    /// `true`, если сессия повторно инициализируется.
    ///
    /// Устанавливается при `recoverFromInvalidTransition` или первой ошибке
    /// обработки commit/welcome. Сбрасывается после успешного завершения
    /// перехода с `transition_id == 0`.
    #[inline]
    pub fn reinitializing(&self) -> bool {
        self.reinitializing
    }

    /// `true`, если в данный момент выполняется переход.
    ///
    /// Используется как защита от повторного входа в `execute_transition`
    /// и от параллельного шифрования во время смены версии протокола.
    #[inline]
    pub fn is_transitioning(&self) -> bool {
        self.is_transitioning
    }

    /// Идентификатор последнего успешно выполненного перехода.
    ///
    /// `None`, если переходов ещё не было или сессия была уничтожена.
    #[inline]
    pub fn last_transition_id(&self) -> Option<u16> {
        self.last_transition_id
    }

    /// `true`, если нативная сессия готова к шифрованию.
    ///
    /// `false`, если нативная сессия ещё не создана или не завершила обмен ключами.
    #[inline]
    pub fn ready(&self) -> bool {
        self.inner
            .as_ref()
            .map(|session| session.is_ready())
            .unwrap_or(false)
    }

    /// Внутренний статус нативной сессии.
    ///
    /// `None`, если нативная сессия ещё не создана. Значения соответствуют
    /// внутреннему перечислению `davey::Status`.
    #[inline]
    pub fn status(&self) -> Option<u8> {
        self.inner
            .as_ref()
            .map(|session| session.status() as u8)
    }

    /// Версия протокола активной нативной сессии.
    ///
    /// Возвращает 0, если нативная сессия ещё не создана. Не путать
    /// с полем `self.version`, которое хранит запрошенную версию и может
    /// отличаться от фактической версии нативной сессии.
    #[inline]
    pub fn protocol_version(&self) -> u16 {
        self.inner
            .as_ref()
            .map(|session| session.protocol_version().get())
            .unwrap_or(0)
    }

    // ---------------------------------------------------------------------
    // External sender
    // ---------------------------------------------------------------------

    /// Устанавливает внешнего отправителя.
    ///
    /// Если нативная сессия уже создана — передаёт значение напрямую,
    /// иначе откладывает до момента инициализации.
    #[inline]
    pub fn set_external_sender(&mut self, data: &[u8]) -> Result<()> {
        match self.inner.as_mut() {
            // Сессия есть — применяем сразу.
            Some(inner) => inner
                .set_external_sender(data)
                .map_err(Self::map_err),

            // Сессия ещё не создана — сохраняем до reinit.
            None => {
                self.pending_external_sender =
                    Some(data.to_vec());

                Ok(())
            }
        }
    }

    // ---------------------------------------------------------------------
    // Epoch
    // ---------------------------------------------------------------------

    /// Обрабатывает данные подготовки эпохи.
    ///
    /// Реагирует только на эпоху 1; остальные случаи игнорируются.
    /// Обновляет версию протокола и запускает `reinit`.
    ///
    /// # Аргументы
    /// * `epoch` — номер эпохи.
    /// * `protocol_version` — версия протокола для этой эпохи.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[inline]
    pub fn prepare_epoch(&mut self, epoch: u32, protocol_version: u16) -> Result<Option<Vec<u8>>> {
        // Уничтоженная сессия не обрабатывает данные.
        if self.destroyed { return Ok(None); }

        // Идёт повторная инициализация — избегаем повторного входа.
        else if self.reinitializing { return Ok(None); }

        // Только первая эпоха вызывает инициализацию.
        else if epoch != 1 { return Ok(None); }

        self.version = protocol_version;
        self.reinit_internal()
    }

    // ---------------------------------------------------------------------
    // Invalid transition recovery
    // ---------------------------------------------------------------------

    /// Запускает восстановление после невалидного перехода.
    ///
    /// Устанавливает флаг `reinitializing`, очищает ожидающие переходы
    /// и выполняет `reinit_internal`.
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор невалидного перехода.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[inline]
    pub fn recover_from_invalid_transition(&mut self, transition_id: u16) -> Result<Option<Vec<u8>>> {
        // Уничтоженная сессия не восстанавливается.
        if self.destroyed { return Ok(None); }

        // Уже в процессе — не входим повторно.
        else if self.reinitializing { return Ok(None); }

        self.reinitializing = true;

        // Все ожидающие переходы больше не актуальны.
        self.clear_transitions();
        let key = match self.reinit_internal() {
            Ok(key) => key,
            Err(error) => {
                // Иначе флаг остался бы true навсегда: `encrypt` возвращал бы
                // `None` (звук пропадает), а повторные восстановления были бы no-op.
                self.reinitializing = false;
                return Err(error);
            }
        };

        // transition_id не используется в восстановлении — принимается для совместимости API.
        let _ = transition_id;

        Ok(key)
    }

    // ---------------------------------------------------------------------
    // Reinit
    // ---------------------------------------------------------------------

    /// Повторно инициализирует нативную сессию с текущей версией протокола.
    ///
    /// # Возвращаемое значение
    /// Новый key-package, если он был создан.
    #[inline]
    pub fn reinit(&mut self) -> Result<Option<Vec<u8>>> {
        self.reinit_internal()
    }

    /// Внутренняя реализация повторной инициализации.
    ///
    /// Для версии > 0 создаёт или повторно инициализирует нативную сессию,
    /// применяет отложенный external sender и возвращает key-package.
    /// Для версии 0 сбрасывает сессию и включает passthrough.
    #[inline]
    fn reinit_internal(&mut self) -> Result<Option<Vec<u8>>> {
        // Уничтоженная сессия повторно не инициализируется.
        if self.destroyed { return Ok(None); }

        if self.version > 0 {
            // Версия должна быть ненулевой для NonZeroU16.
            let version = NonZeroU16::new(self.version)
                .ok_or_else(|| {
                    MlsError::from_reason(
                        "Protocol version must be non-zero",
                    )
                })?;

            // Парсим идентификаторы из строк.
            let user_id = Self::parse_id(&self.user_id, "user id")?;
            let channel_id = Self::parse_id(&self.channel_id, "channel id")?;

            match self.inner.as_mut() {
                // Сессия уже существует — повторно инициализируем.
                Some(inner) => {
                    inner
                        .reinit(
                            version,
                            user_id,
                            channel_id,
                            None,
                        )
                        .map_err(Self::map_err)?;
                }

                // Сессия ещё не создана — создаём новую.
                None => {
                    self.inner = Some(
                        davey::DaveSession::new(
                            version,
                            user_id,
                            channel_id,
                            None,
                        )
                            .map_err(Self::map_err)?,
                    );
                }
            }

            // Применяем отложенный external sender.
            if let Some(external_sender) =
                self.pending_external_sender.take()
            {
                self.inner
                    .as_mut()
                    .unwrap()
                    .set_external_sender(&external_sender)
                    .map_err(Self::map_err)?;
            }

            // Формируем key-package для отправки другим участникам.
            let key_package = self
                .inner
                .as_mut()
                .unwrap()
                .create_key_package()
                .map_err(Self::map_err)?;

            return Ok(Some(Vec::from(key_package)));
        }

        // Версия 0: сбрасываем сессию и включаем passthrough.
        if let Some(inner) = self.inner.as_mut() {
            inner.reset().map_err(Self::map_err)?;
            inner.set_passthrough_mode(true, Some(TRANSITION_EXPIRY));
        }

        Ok(None)
    }

    // ---------------------------------------------------------------------
    // Reset
    // ---------------------------------------------------------------------

    /// Сбрасывает состояние нативной сессии без её уничтожения.
    #[inline]
    pub fn reset(&mut self) -> Result<()> {
        match self.inner.as_mut() {
            Some(inner) => {
                inner.reset().map_err(Self::map_err)
            }

            // Сессии ещё нет — сбрасывать нечего.
            None => Ok(()),
        }
    }

    // ---------------------------------------------------------------------
    // Destroy
    // ---------------------------------------------------------------------

    /// Полностью уничтожает сессию и освобождает ресурсы.
    /// Идемпотентен: повторный вызов не выполняет действий.
    #[inline]
    pub fn destroy(&mut self) {
        // Защита от повторного вызова.
        if self.destroyed { return; }

        self.destroyed = true;
        self.is_transitioning = true;

        // Сбрасываем нативную сессию, если она была создана.
        if let Some(inner) = self.inner.as_mut() {
            let _ = inner.reset();
        }

        // Очищаем ожидающие переходы.
        self.clear_transitions();

        // Обнуляем ссылки для помощи сборщику мусора.
        self.inner = None;
        self.pending_external_sender = None;

        self.reinitializing = false;
        self.downgraded = false;

        self.last_transition_id = None;
    }

    // ---------------------------------------------------------------------
    // Passthrough
    // ---------------------------------------------------------------------

    /// Включает или выключает passthrough-режим.
    ///
    /// В passthrough медиа-пакеты передаются без шифрования и расшифровки.
    ///
    /// # Аргументы
    /// * `enabled` — `true` для включения.
    /// * `expiry` — время жизни режима в секундах (опционально).
    #[inline]
    pub fn set_passthrough_mode(&mut self, enabled: bool, expiry: Option<u32>) {
        // Если сессии нет — операция игнорируется.
        if let Some(inner) = self.inner.as_mut() {
            inner.set_passthrough_mode(
                enabled,
                expiry,
            );
        }
    }

    // ---------------------------------------------------------------------
    // Key package
    // ---------------------------------------------------------------------

    /// Возвращает сериализованный key-package.
    ///
    /// # Ошибки
    /// Возвращает ошибку, если нативная сессия ещё не создана.
    #[inline]
    pub fn get_serialized_key_package(&mut self) -> Result<Vec<u8>> {
        // Без активной сессии key-package создать нельзя.
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| {
                MlsError::from_reason(
                    "Session not initialized",
                )
            })?;

        let key_package = inner.create_key_package().map_err(Self::map_err)?;
        Ok(Vec::from(key_package))
    }

    // ---------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------

    /// Обрабатывает proposals от другого участника.
    ///
    /// # Аргументы
    /// * `operation_type` — тип операции (0 или 1).
    /// * `proposals` — сериализованные предложения.
    /// * `recognized_user_ids` — известные идентификаторы пользователей.
    ///
    /// # Возвращаемое значение
    /// `ProposalsResult` с commit и welcome (если есть).
    #[inline]
    pub fn process_proposals(&mut self, operation_type: u8, proposals: &[u8], recognized_user_ids: Option<Vec<String>>) -> Result<ProposalsResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Если сессии нет — возвращаем пустой результат.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(ProposalsResult {
                    commit: None,
                    welcome: None,
                });
            }
        };

        // Преобразуем числовой код операции в enum.
        let operation = Self::map_operation(operation_type)?;

        // Парсим recognized user ids, если переданы.
        let recognized_ids =
            match recognized_user_ids {
                Some(ids) => Some(
                    ids.into_iter()
                        .map(|id| {
                            Self::parse_id(
                                &id,
                                "recognized user id",
                            )
                        })
                        .collect::<Result<Vec<_>>>()?,
                ),

                None => None,
            };

        let result = inner.process_proposals(
            operation,
            proposals,
            recognized_ids.as_deref(),
        )
            .map_err(Self::map_err)?;

        Ok(match result {
            // Результат содержит commit (и, возможно, welcome).
            Some(commit_welcome) => {
                ProposalsResult {
                    commit: Some(Vec::from(commit_welcome.commit)),
                    welcome: commit_welcome.welcome.map(Vec::from),
                }
            }

            // Коммит не требуется.
            None => ProposalsResult {
                commit: None,
                welcome: None,
            },
        })
    }

    // ---------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------

    /// Обрабатывает commit от другого участника.
    ///
    /// Первые два байта payload — `transition_id`.
    ///
    /// # Аргументы
    /// * `payload` — сериализованные данные commit.
    ///
    /// # Возвращаемое значение
    /// `TransitionResult` с `transition_id`, флагом успеха и признаком
    /// невалидности (для инициирования повторной инициализации).
    #[inline]
    pub fn process_commit(&mut self, payload: &[u8]) -> Result<TransitionResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Минимум 2 байта под transition_id.
        if payload.len() < 2 {
            return Err(MlsError::from_reason(
                "Commit payload too short",
            ));
        }

        // transition_id в первых двух байтах (BE).
        let transition_id = u16::from_be_bytes([
            payload[0],
            payload[1],
        ]);

        // Если сессии нет — вернуть неуспех без повторной инициализации.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match inner.process_commit(&payload[2..]) {
            Ok(()) => {
                if transition_id != 0 {
                    // Ненулевой id — переход откладывается до execute_transition.
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version: self.version,
                            expires_at: Instant::now()
                                + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    // Нулевой id — переход завершён сразу.
                    self.reinitializing = false;
                    self.last_transition_id =
                        Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }

            Err(error) => {
                if !self.reinitializing {
                    // Первая ошибка — сигнал о необходимости повторной инициализации.
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
                    // Уже повторно инициализируемся — повторную ошибку не сигналим.
                    let _ = error;

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: false,
                    })
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Welcome
    // ---------------------------------------------------------------------

    /// Обрабатывает welcome от другого участника.
    ///
    /// Логика аналогична `process_commit`, но применяется к данным
    /// приветственного сообщения.
    ///
    /// # Аргументы
    /// * `payload` — сериализованные данные welcome.
    #[inline]
    pub fn process_welcome(&mut self, payload: &[u8]) -> Result<TransitionResult> {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Минимум 2 байта под transition_id.
        if payload.len() < 2 {
            return Err(MlsError::from_reason(
                "Welcome payload too short",
            ));
        }

        // transition_id в первых двух байтах (BE).
        let transition_id =
            u16::from_be_bytes([
                payload[0],
                payload[1],
            ]);

        // Если сессии нет — вернуть неуспех без повторной инициализации.
        let inner = match self.inner.as_mut() {
            Some(inner) => inner,

            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match inner.process_welcome(&payload[2..]) {
            Ok(()) => {
                if transition_id != 0 {
                    // Ненулевой id — переход откладывается до execute_transition.
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version: self.version,
                            expires_at: Instant::now()
                                + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    // Нулевой id — переход завершён сразу.
                    self.reinitializing = false;
                    self.last_transition_id =
                        Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }

            Err(error) => {
                if !self.reinitializing {
                    // Первая ошибка — сигнал о необходимости повторной инициализации.
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
                    // Уже повторно инициализируемся — повторную ошибку не сигналим.
                    let _ = error;

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: false,
                    })
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Prepare transition
    // ---------------------------------------------------------------------

    /// Регистрирует ожидаемый переход.
    ///
    /// Для `transition_id == 0` переход выполняется немедленно. Для
    /// `protocol_version == 0` включается passthrough с увеличенным сроком
    /// (ожидание подтверждения понижения).
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор перехода.
    /// * `protocol_version` — целевая версия протокола.
    ///
    /// # Возвращаемое значение
    /// `true`, если переход требует вызова `execute_transition`.
    #[inline]
    pub fn prepare_transition(&mut self, transition_id: u16, protocol_version: u16) -> bool {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Регистрируем переход с тайм-аутом.
        self.pending_transitions.insert(
            transition_id,
            PendingTransition {
                version: protocol_version,
                expires_at: Instant::now()
                    + TRANSITION_TIMEOUT,
            },
        );

        // transition_id == 0 — немедленный переход.
        if transition_id == 0 {
            let _ = self.execute_transition(0);
        }

        // Переход на версию 0 — включаем passthrough с увеличенным сроком.
        if protocol_version == 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(
                    true,
                    Some(
                        TRANSITION_EXPIRY_PENDING_DOWNGRADE,
                    ),
                );
            }
        }

        transition_id != 0
    }

    // ---------------------------------------------------------------------
    // Execute transition
    // ---------------------------------------------------------------------

    /// Выполняет ранее зарегистрированный переход.
    ///
    /// # Аргументы
    /// * `transition_id` — идентификатор перехода.
    ///
    /// # Возвращаемое значение
    /// `true`, если переход выполнен; `false`, если запись отсутствует
    /// или уже выполняется другой переход.
    #[inline]
    pub fn execute_transition(&mut self, transition_id: u16) -> bool {
        // Удаляем устаревшие переходы.
        self.expire_transitions();

        // Защита от повторного входа.
        if self.is_transitioning { return false; }

        // Переход должен быть зарегистрирован.
        let version = match self.pending_transitions.get(
            &transition_id,
        ) {
            Some(pending) => pending.version,
            None => return false,
        };

        self.is_transitioning = true;
        let old_version = self.version;

        // Применяем новую версию.
        self.version = version;

        if self.version > 0 {
            // Новая версия — нативную сессию нужно пересоздать на неё.
            let _ = self.reinit_internal();
        }

        // Фиксируем понижение до версии 0.
        if old_version != 0 && self.version == 0 {
            self.downgraded = true;
        }

        // При восстановлении после понижения включаем passthrough.
        if self.downgraded && self.version > 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(
                    true,
                    Some(TRANSITION_EXPIRY),
                );
            }

            self.downgraded = false;
        }

        self.last_transition_id = Some(transition_id);

        // Запись о переходе больше не нужна.
        self.pending_transitions.remove(&transition_id);
        self.is_transitioning = false;

        true
    }

    // ---------------------------------------------------------------------
    // Encrypt
    // ---------------------------------------------------------------------

    /// Шифрует массив Opus-пакетов.
    ///
    /// Возвращает `None`, если шифрование невозможно: версия 0, идёт
    /// переход, идёт повторная инициализация, сессия не готова, либо один из
    /// пакетов не удалось зашифровать (batch считается неуспешным целиком).
    ///
    /// # Аргументы
    /// * `packets` — исходные Opus-пакеты.
    ///
    /// # Возвращаемое значение
    /// Вектор зашифрованных пакетов или `None`.
    #[inline]
    pub fn encrypt(&mut self, packets: Vec<Vec<u8>>) -> Option<Vec<Vec<u8>>> {
        // Passthrough-режим или нестабильное состояние — не шифруем.
        if self.version == 0 || self.is_transitioning || self.reinitializing { return None; }

        let inner = self.inner.as_mut()?;

        // Сессия ещё не готова к шифрованию.
        if !inner.is_ready() { return None; }

        let mut output = Vec::with_capacity(packets.len());
        for packet in packets {
            // Нативный encrypt_opus может паниковать — перехватываем.
            let encrypted = std::panic::catch_unwind(
                std::panic::AssertUnwindSafe(
                    || {
                        inner.encrypt_opus(&packet)
                    },
                ),
            );

            match encrypted {
                Ok(Ok(buffer)) => {
                    output.push(buffer.to_vec());
                }

                // Batch считается неуспешным целиком.
                _ => return None,
            }
        }

        Some(output)
    }
}

impl MlsSession {
    /// Удаляет записи о переходах, срок которых истёк.
    ///
    /// Каждая запись в `pending_transitions` имеет `expires_at`, и если
    /// `execute_transition` не был вызван за `TRANSITION_TIMEOUT`,
    /// запись считается устаревшей и удаляется.
    #[inline]
    fn expire_transitions(&mut self) {
        // Одно чтение времени на всю операцию — дешевле, чем в замыкании.
        let now = Instant::now();

        // retain оставляет только те записи, чей срок ещё не истёк.
        self.pending_transitions
            .retain(|_, transition| {
                transition.expires_at > now
            });
    }

    /// Очищает все записи об ожидающих переходах.
    ///
    /// Используется при повторной инициализации (когда прежние переходы
    /// больше не актуальны) и при уничтожении сессии.
    #[inline]
    fn clear_transitions(&mut self) {
        self.pending_transitions.clear();
    }

    /// Преобразует ошибку `davey` в `MlsError` с префиксом `[MlsSession]`.
    ///
    /// Единая точка для прохождения ошибок нативного слоя наверх —
    /// упрощает поиск источника по префиксу в логах.
    #[inline]
    fn map_err<E: std::fmt::Display>(error: E) -> MlsError {
        MlsError::from_reason(format!(
            "[MlsSession] {}",
            error
        ))
    }

    /// Парсит строковый идентификатор в `u64`.
    ///
    /// # Аргументы
    /// * `id` — строка с числовым идентификатором.
    /// * `name` — имя поля для понятного сообщения об ошибке
    ///   (например, `"user id"`).
    ///
    /// # Возвращаемое значение
    /// `Ok(u64)` при успешном парсинге.
    ///
    /// # Ошибки
    /// Возвращает ошибку с указанием имени поля, если строка не парсится.
    #[inline]
    fn parse_id(id: &str, name: &str) -> Result<u64> {
        // Пытаемся распарсить строку; при ошибке подставляем имя поля.
        id.parse().map_err(|_| {
            MlsError::from_reason(format!(
                "Invalid {}: {}",
                name,
                id
            ))
        })
    }

    /// Преобразует числовой код операции в enum `davey`.
    ///
    /// # Аргументы
    /// * `operation` — код операции из payload.
    ///
    /// # Возвращаемое значение
    /// `ProposalsOperationType` для известного кода.
    ///
    /// # Ошибки
    /// Возвращает ошибку для неизвестных значений.
    #[inline]
    fn map_operation(operation: u8) -> Result<davey::ProposalsOperationType> {
        match operation {
            // Код 0 → APPEND.
            0 => Ok(
                davey::ProposalsOperationType::APPEND,
            ),

            // Код 1 → APPEND. Соответствует текущему протоколу —
            // другие типы операций пока не используются.
            1 => Ok(
                davey::ProposalsOperationType::APPEND,
            ),

            // Любой другой код — ошибка.
            _ => Err(MlsError::from_reason(format!(
                "Invalid operation: {operation}"
            ))),
        }
    }
}

/// Сброс нативной сессии при уничтожении обёртки.
impl Drop for MlsSession {
    fn drop(&mut self) {
        // Пытаемся корректно завершить сессию, ошибки игнорируем.
        if let Some(inner) = self.inner.as_mut() {
            let _ = inner.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Создаёт сессию с числовыми id-строками, которые заведомо парсятся.
    /// version = 0 гарантирует, что `reinit_internal` не полезет
    /// создавать реальный `davey::DaveSession`.
    fn session_v0() -> MlsSession {
        MlsSession::new(0, "123".to_string(), "456".to_string())
    }

    /// Аналог `session_v0`, но с версией 1 — для тестов, которым нужно
    /// состояние «версия ненулевая», но без реальной нативной сессии.
    fn session_v1() -> MlsSession {
        MlsSession::new(1, "123".to_string(), "456".to_string())
    }

    // ---------------------------------------------------------------------
    // Constructor / initial state
    // ---------------------------------------------------------------------

    #[test]
    // Проверяет, что после `new` все поля находятся в исходном состоянии:
    // флаги сброшены, нативной сессии нет, буферов нет, версия/ids сохранены.
    // Проверка и через геттеры, и через прямые поля — чтобы не пропустить
    // расхождение между ними.
    fn new_session_initial_state() {
        let s = session_v1();

        assert!(!s.destroyed());
        assert!(!s.reinitializing());
        assert!(!s.is_transitioning());
        assert!(!s.downgraded);
        assert_eq!(s.last_transition_id(), None);
        assert!(!s.ready());
        assert_eq!(s.status(), None);
        assert_eq!(s.protocol_version(), 0);

        assert!(s.inner.is_none());
        assert!(s.pending_external_sender.is_none());
        assert!(s.pending_transitions.is_empty());
        assert_eq!(s.version, 1);
        assert_eq!(s.user_id, "123");
        assert_eq!(s.channel_id, "456");
    }

    #[test]
    // Отдельно проверяет все публичные геттеры в исходном состоянии.
    // Дублирование с предыдущим тестом намеренное: если кто-то поменяет
    // геттер, а поля останутся корректными (или наоборот), это будет
    // видно по падению именно этого теста.
    fn getters_reflect_initial_state() {
        let s = session_v1();
        assert_eq!(s.destroyed(), false);
        assert_eq!(s.reinitializing(), false);
        assert_eq!(s.is_transitioning(), false);
        assert_eq!(s.last_transition_id(), None);
        assert_eq!(s.ready(), false);
        assert_eq!(s.status(), None);
        assert_eq!(s.protocol_version(), 0);
    }

    // ---------------------------------------------------------------------
    // Destroy
    // ---------------------------------------------------------------------

    #[test]
    // `destroy()` должен не только выставить флаг, но и очистить всё
    // состояние: ожидающие переходы, отложенный external sender, ссылки
    // на нативную сессию, last_transition_id, вторичные флаги.
    fn destroy_sets_destroyed_and_clears_state() {
        let mut s = session_v1();
        s.pending_transitions.insert(
            1,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );
        s.pending_external_sender = Some(vec![1, 2, 3]);
        s.last_transition_id = Some(9);

        s.destroy();

        assert!(s.destroyed());
        assert!(s.is_transitioning);
        assert!(s.pending_transitions.is_empty());
        assert!(s.inner.is_none());
        assert!(s.pending_external_sender.is_none());
        assert_eq!(s.last_transition_id(), None);
        assert!(!s.reinitializing);
        assert!(!s.downgraded);
    }

    #[test]
    // Повторный `destroy()` не должен ничего ломать: второй вызов видит
    // `destroyed == true` и сразу выходит.
    fn destroy_is_idempotent() {
        let mut s = session_v1();
        s.destroy();
        s.destroy();
        assert!(s.destroyed());
    }

    #[test]
    // Уничтоженная сессия не реагирует на `prepare_epoch`: возвращает
    // None и не трогает поле `version`.
    fn destroyed_short_circuits_prepare_epoch() {
        let mut s = session_v1();
        s.destroy();
        assert!(s.prepare_epoch(1, 5).unwrap().is_none());
        // version не должен был измениться.
        assert_eq!(s.version, 1);
    }

    #[test]
    // Уничтоженная сессия не запускает повторную инициализацию.
    fn destroyed_short_circuits_reinit() {
        let mut s = session_v1();
        s.destroy();
        assert!(s.reinit().unwrap().is_none());
    }

    #[test]
    // Уничтоженная сессия не пытается восстанавливаться после
    // невалидного перехода.
    fn destroyed_short_circuits_recover() {
        let mut s = session_v1();
        s.destroy();
        assert!(s.recover_from_invalid_transition(1).unwrap().is_none());
    }

    // ---------------------------------------------------------------------
    // parse_id
    // ---------------------------------------------------------------------

    #[test]
    // Идентификаторы — положительные числа вплоть до `u64::MAX`.
    // Ноль допустим: это валидное значение для snowflake-подобных id.
    fn parse_id_accepts_valid_numbers() {
        assert_eq!(MlsSession::parse_id("123", "user id").unwrap(), 123);
        assert_eq!(MlsSession::parse_id("0", "user id").unwrap(), 0);
        assert_eq!(
            MlsSession::parse_id("18446744073709551615", "user id").unwrap(),
            u64::MAX,
        );
    }

    #[test]
    // Всё, что не является десятичным числом без знака, отвергается:
    // буквы, пустая строка, отрицательное значение, дробное.
    fn parse_id_rejects_invalid_input() {
        assert!(MlsSession::parse_id("abc", "user id").is_err());
        assert!(MlsSession::parse_id("", "user id").is_err());
        assert!(MlsSession::parse_id("-1", "user id").is_err());
        assert!(MlsSession::parse_id("1.5", "user id").is_err());
    }

    // ---------------------------------------------------------------------
    // map_operation
    // ---------------------------------------------------------------------

    #[test]
    // Протокол сейчас знает только два кода операций: 0 и 1.
    // Оба должны отображаться в APPEND.
    fn map_operation_accepts_0_and_1() {
        assert!(MlsSession::map_operation(0).is_ok());
        assert!(MlsSession::map_operation(1).is_ok());
    }

    #[test]
    // Всё, что не 0 и не 1, считается неизвестной операцией и
    // превращается в ошибку — не должно молча проходить дальше.
    fn map_operation_rejects_unknown() {
        assert!(MlsSession::map_operation(2).is_err());
        assert!(MlsSession::map_operation(255).is_err());
    }

    // ---------------------------------------------------------------------
    // map_err
    // ---------------------------------------------------------------------

    #[test]
    // Проверяет, что `map_err` добавляет префикс `[MlsSession]` к тексту
    // ошибки, но не теряет сам текст. Префикс нужен для поиска источника
    // в логах.
    fn map_err_adds_prefix() {
        let err = MlsSession::map_err("boom");
        let msg = format!("{}", err);
        assert!(
            msg.contains("[MlsSession]"),
            "сообщение без префикса: {msg}"
        );
        assert!(msg.contains("boom"), "сообщение без текста ошибки: {msg}");
    }

    // ---------------------------------------------------------------------
    // expire_transitions / clear_transitions
    // ---------------------------------------------------------------------

    #[test]
    // Запись с `expires_at` в прошлом считается устаревшей и удаляется.
    fn expire_transitions_removes_expired_entries() {
        let mut s = session_v1();
        s.pending_transitions.insert(
            1,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() - Duration::from_secs(10),
            },
        );

        s.expire_transitions();

        assert!(s.pending_transitions.is_empty());
    }

    #[test]
    // Свежая запись (срок в будущем) должна остаться.
    fn expire_transitions_keeps_fresh_entries() {
        let mut s = session_v1();
        s.pending_transitions.insert(
            1,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );

        s.expire_transitions();

        assert_eq!(s.pending_transitions.len(), 1);
    }

    #[test]
    // Смешанный случай: одна запись истекла, другая — нет. Удаляется
    // только истёкшая, по ключу проверяется, что осталась именно свежая.
    fn expire_transitions_mixed() {
        let mut s = session_v1();
        s.pending_transitions.insert(
            1,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() - Duration::from_secs(1),
            },
        );
        s.pending_transitions.insert(
            2,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );

        s.expire_transitions();

        assert_eq!(s.pending_transitions.len(), 1);
        assert!(s.pending_transitions.contains_key(&2));
    }

    #[test]
    // `clear_transitions` удаляет всё, что есть в мапе, независимо от сроков.
    fn clear_transitions_empties_map() {
        let mut s = session_v1();
        s.pending_transitions.insert(
            1,
            PendingTransition {
                version: 1,
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );
        assert_eq!(s.pending_transitions.len(), 1);
        s.clear_transitions();
        assert!(s.pending_transitions.is_empty());
    }

    // ---------------------------------------------------------------------
    // prepare_transition / execute_transition
    // ---------------------------------------------------------------------

    #[test]
    // Переход с ненулевым id только регистрируется: `is_transitioning`
    // остаётся false, `last_transition_id` не выставляется, `version`
    // не меняется. Всё это произойдёт только в `execute_transition`.
    fn prepare_transition_with_nonzero_id_defers() {
        let mut s = session_v0();
        assert!(s.prepare_transition(5, 1));
        assert_eq!(s.pending_transitions.len(), 1);
        assert!(!s.is_transitioning);
        assert_eq!(s.last_transition_id(), None);
        // version ещё не поменялся — переход отложен.
        assert_eq!(s.version, 0);
    }

    #[test]
    // Переход с id == 0 выполняется сразу внутри `prepare_transition`.
    // Возвращаемое значение — false, потому что вызывающему не нужно
    // потом звать `execute_transition`.
    fn prepare_transition_with_zero_id_executes_immediately() {
        let mut s = session_v0();
        // Для id == 0 возвращаемое значение — false.
        assert!(!s.prepare_transition(0, 0));
        assert_eq!(s.last_transition_id(), Some(0));
        assert!(s.pending_transitions.is_empty());
    }

    #[test]
    // `execute_transition` без предварительной регистрации ничего не делает:
    // в мапе нет записи, значит и переходить некуда.
    fn execute_transition_with_unknown_id_returns_false() {
        let mut s = session_v1();
        assert!(!s.execute_transition(42));
        assert_eq!(s.last_transition_id(), None);
    }

    #[test]
    // Обычный сценарий: зарегистрировали — выполнили. После выполнения
    // запись удаляется, `last_transition_id` выставляется, флаг
    // `is_transitioning` снимается.
    fn execute_transition_with_registered_id_succeeds() {
        let mut s = session_v0();
        s.prepare_transition(7, 0);
        assert!(s.execute_transition(7));
        assert_eq!(s.last_transition_id(), Some(7));
        assert!(s.pending_transitions.is_empty());
        assert!(!s.is_transitioning);
    }

    #[test]
    // Переход с ненулевой версии на нулевую выставляет флаг `downgraded`.
    // Он используется позже: при возврате к ненулевой версии включается
    // passthrough на короткое время.
    fn execute_transition_downgrade_to_zero_sets_flag() {
        let mut s = session_v1();
        s.prepare_transition(3, 0);
        assert!(s.execute_transition(3));
        assert_eq!(s.version, 0);
        assert!(s.downgraded);
    }

    #[test]
    // Защита от повторного входа: если `is_transitioning` уже стоит,
    // `execute_transition` обязан вернуть false и не начинать второй
    // переход поверх первого.
    fn execute_transition_reentry_blocked() {
        let mut s = session_v0();
        s.prepare_transition(1, 0);
        s.is_transitioning = true;
        assert!(!s.execute_transition(1));
    }

    // ---------------------------------------------------------------------
    // prepare_epoch
    // ---------------------------------------------------------------------

    #[test]
    // Эпоха 0 не считается началом: `prepare_epoch` её игнорирует.
    fn prepare_epoch_ignores_epoch_zero() {
        let mut s = session_v1();
        assert!(s.prepare_epoch(0, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    #[test]
    // Только эпоха 1 запускает инициализацию. Эпоха 2 и далее — игнор.
    fn prepare_epoch_ignores_non_first_epoch() {
        let mut s = session_v1();
        assert!(s.prepare_epoch(2, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    #[test]
    // Если уже идёт повторная инициализация — новый `prepare_epoch`
    // не должен её прерывать или запускать параллельно.
    fn prepare_epoch_skipped_while_reinitializing() {
        let mut s = session_v1();
        s.reinitializing = true;
        assert!(s.prepare_epoch(1, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    // ---------------------------------------------------------------------
    // recover_from_invalid_transition
    // ---------------------------------------------------------------------

    #[test]
    // Если уже идёт повторная инициализация, повторное восстановление
    // не запускается.
    fn recover_skipped_when_already_reinitializing() {
        let mut s = session_v1();
        s.reinitializing = true;
        assert!(s.recover_from_invalid_transition(5).unwrap().is_none());
    }

    #[test]
    // Восстановление очищает все ожидающие переходы: они больше
    // не актуальны, потому что версия протокола будет пересобрана заново.
    // После восстановления выставляется флаг `reinitializing`.
    fn recover_clears_pending_transitions() {
        let mut s = session_v0();
        s.prepare_transition(1, 0);
        assert_eq!(s.pending_transitions.len(), 1);

        let _ = s.recover_from_invalid_transition(1).unwrap();

        assert!(s.pending_transitions.is_empty());
        assert!(s.reinitializing);
    }

    // ---------------------------------------------------------------------
    // reinit / reset
    // ---------------------------------------------------------------------

    #[test]
    // Для версии 0 при отсутствии нативной сессии `reinit` ничего
    // не создаёт и возвращает None.
    fn reinit_version_zero_without_session_returns_none() {
        let mut s = session_v0();
        assert!(s.reinit().unwrap().is_none());
        assert!(s.inner.is_none());
    }

    #[test]
    // `reset` при отсутствии сессии — валидный no-op, а не ошибка.
    // Упрощает вызывающему коду: не нужно проверять, создана ли сессия.
    fn reset_without_session_is_ok() {
        let mut s = session_v1();
        assert!(s.reset().is_ok());
    }

    // ---------------------------------------------------------------------
    // encrypt (без данных — только короткое замыкание)
    // ---------------------------------------------------------------------

    #[test]
    // Версия 0 = passthrough, шифрование не выполняется.
    fn encrypt_version_zero_returns_none() {
        let mut s = session_v0();
        assert!(s.encrypt(Vec::new()).is_none());
    }

    #[test]
    // Нативной сессии нет — шифровать нечем.
    fn encrypt_without_session_returns_none() {
        let mut s = session_v1();
        assert!(s.encrypt(Vec::new()).is_none());
    }

    #[test]
    // Во время перехода шифрование запрещено: версия протокола ещё
    // не устоялась, шифровать нечем и некуда.
    fn encrypt_while_transitioning_returns_none() {
        let mut s = session_v1();
        s.is_transitioning = true;
        assert!(s.encrypt(Vec::new()).is_none());
    }

    #[test]
    // То же самое для повторной инициализации: пока состояние нестабильно,
    // шифрование не запускается.
    fn encrypt_while_reinitializing_returns_none() {
        let mut s = session_v1();
        s.reinitializing = true;
        assert!(s.encrypt(Vec::new()).is_none());
    }

    // ---------------------------------------------------------------------
    // set_passthrough_mode без сессии
    // ---------------------------------------------------------------------

    #[test]
    // Установка passthrough без нативной сессии — no-op: нативная сессия
    // не должна создаваться «побочным эффектом» сеттера.
    fn set_passthrough_mode_without_session_is_noop() {
        let mut s = session_v1();
        s.set_passthrough_mode(true, Some(10));
        // Нативной сессии нет — она не должна была создаться.
        assert!(s.inner.is_none());
    }

    // ---------------------------------------------------------------------
    // get_serialized_key_package без сессии
    // ---------------------------------------------------------------------

    #[test]
    // Без нативной сессии key-package создать нельзя: метод обязан
    // вернуть ошибку, а не панику и не пустой вектор.
    fn get_serialized_key_package_without_session_errors() {
        let mut s = session_v1();
        // Возвращаемый тип Result<Vec<u8>>, но нам достаточно is_err().
        assert!(s.get_serialized_key_package().is_err());
    }
}