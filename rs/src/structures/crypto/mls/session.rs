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

    /// `true`, если после ошибки перехода сессию нужно инициализировать заново.
    ///
    /// Пока флаг поднят, `encrypt` ничего не шифрует. Сбрасывается после
    /// успешной повторной инициализации.
    #[inline]
    pub fn reinitializing(&self) -> bool {
        self.reinitializing
    }

    /// `true`, пока выполняется `execute_transition` (защита от повторного
    /// входа). Состояние кратковременное: снаружи оно видно только после
    /// `destroy`, который поднимает флаг навсегда.
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
                self.pending_external_sender = Some(data.to_vec());
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
                    MlsError::from_reason("Protocol version must be non-zero")
                })?;

            // Парсим идентификаторы из строк.
            let user_id = Self::parse_id(&self.user_id, "user id")?;
            let channel_id = Self::parse_id(&self.channel_id, "channel id")?;

            match self.inner.as_mut() {
                // Сессия уже существует — повторно инициализируем.
                Some(inner) => {
                    inner.reinit(version, user_id, channel_id, None).map_err(Self::map_err)?;
                }

                // Сессия ещё не создана — создаём новую.
                None => {
                    self.inner = Some(davey::DaveSession::new(version, user_id, channel_id, None).map_err(Self::map_err)?);
                }
            }

            // Применяем отложенный external sender.
            if let Some(external_sender) = self.pending_external_sender.take()
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
            inner.set_passthrough_mode(enabled, expiry);
        }
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
                    welcome: None
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
                        .collect::<Result<Vec<_>>>()?
                ),

                None => None
            };

        let result = inner.process_proposals(operation, proposals, recognized_ids.as_deref()).map_err(Self::map_err)?;

        Ok(match result {
            // Результат содержит commit (и, возможно, welcome).
            Some(commit_welcome) => {
                ProposalsResult {
                    commit: Some(Vec::from(commit_welcome.commit)),
                    welcome: commit_welcome.welcome.map(Vec::from)
                }
            }

            // Коммит не требуется.
            None => ProposalsResult {
                commit: None,
                welcome: None
            },
        })
    }

    // ---------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------

    /// Обрабатывает commit от другого участника.
    ///
    /// Первые два байта payload — `transition_id`; оставшаяся часть передаётся
    /// в `davey::DaveSession::process_commit`.
    ///
    /// `davey` версии 0.2.x возвращает `Ok(false)`, если commit был проигнорирован.
    /// Это не считается невалидным переходом и не запускает восстановление.
    #[inline]
    pub fn process_commit(&mut self, payload: &[u8]) -> Result<TransitionResult> {
        self.expire_transitions();

        if payload.len() < 2 {
            return Err(MlsError::from_reason("Commit payload too short"));
        }

        let transition_id = u16::from_be_bytes([payload[0], payload[1]]);

        let processed = match self.inner.as_mut() {
            Some(inner) => inner.process_commit(&payload[2..]),
            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match processed {
            Ok(false) => Ok(TransitionResult {
                transition_id,
                success: false,
                invalidated: false,
            }),
            Ok(true) => {
                // КРИТИЧНО: davey 0.2.x не обновляет decryptor ratchets
                // внутри process_commit(). Подготовить переход нужно сразу
                // после успешного COMMIT и ДО отправки TRANSITION_READY.
                // Это верно и для ненулевых transition_id: EXECUTE_TRANSITION
                // позже переключает отправляющий ratchet, но входящие ratchets
                // должны быть готовы уже сейчас.
                let version = self.version;
                let prepare_result = self
                    .inner
                    .as_mut()
                    .map(|inner| inner.prepare_transition(transition_id, version));

                match prepare_result {
                    Some(Ok(())) => {}
                    Some(Err(_)) | None => {
                        self.reinitializing = true;
                        self.clear_transitions();
                        return Ok(TransitionResult {
                            transition_id,
                            success: false,
                            invalidated: true,
                        });
                    }
                }

                if transition_id != 0 {
                    // Нативный davey уже подготовил ratchets и зарегистрировал
                    // этот transition_id; здесь храним версию для обёртки.
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version,
                            expires_at: Instant::now() + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    // davey выполнил переход с id == 0 прямо в prepare_transition.
                    self.reinitializing = false;
                    self.last_transition_id = Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }
            Err(_) => {
                if !self.reinitializing {
                    // Первая ошибка означает, что состояние MLS нужно пересобрать.
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
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
    /// Первые два байта payload — `transition_id`; остальные байты являются
    /// сериализованным welcome. В новой API `davey` также принимает список
    /// распознанных пользователей; текущий интерфейс обёртки его не передаёт.
    #[inline]
    pub fn process_welcome(&mut self, payload: &[u8]) -> Result<TransitionResult> {
        self.expire_transitions();

        if payload.len() < 2 {
            return Err(MlsError::from_reason("Welcome payload too short"));
        }

        let transition_id = u16::from_be_bytes([payload[0], payload[1]]);

        let processed = match self.inner.as_mut() {
            Some(inner) => inner.process_welcome(&payload[2..], None),
            None => {
                return Ok(TransitionResult {
                    transition_id,
                    success: false,
                    invalidated: false,
                });
            }
        };

        match processed {
            Ok(()) => {
                // Как и для COMMIT, process_welcome() в davey 0.2.x
                // создаёт MLS-группу, но не готовит media key ratchets.
                // Подготовка обязательна для нового участника до READY.
                let version = self.version;
                let prepare_result = self
                    .inner
                    .as_mut()
                    .map(|inner| inner.prepare_transition(transition_id, version));

                match prepare_result {
                    Some(Ok(())) => {}
                    Some(Err(_)) | None => {
                        self.reinitializing = true;
                        self.clear_transitions();
                        return Ok(TransitionResult {
                            transition_id,
                            success: false,
                            invalidated: true,
                        });
                    }
                }

                if transition_id != 0 {
                    self.pending_transitions.insert(
                        transition_id,
                        PendingTransition {
                            version,
                            expires_at: Instant::now() + TRANSITION_TIMEOUT,
                        },
                    );
                } else {
                    self.reinitializing = false;
                    self.last_transition_id = Some(transition_id);
                }

                Ok(TransitionResult {
                    transition_id,
                    success: true,
                    invalidated: false,
                })
            }
            Err(_) => {
                if !self.reinitializing {
                    self.reinitializing = true;
                    self.clear_transitions();

                    Ok(TransitionResult {
                        transition_id,
                        success: false,
                        invalidated: true,
                    })
                } else {
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
    /// `protocol_version == 0` включается passthrough с увеличенным сроком.
    /// При наличии нативной сессии подготовка также передаётся в `davey`.
    ///
    /// Возвращает `true`, если требуется отдельный вызов `execute_transition`.
    #[inline]
    pub fn prepare_transition(&mut self, transition_id: u16, protocol_version: u16) -> bool {
        self.expire_transitions();

        if self.destroyed || self.is_transitioning {
            return false;
        }

        // В davey 0.2.x подготовка перехода — явный шаг протокола.
        let prepare_result = self
            .inner
            .as_mut()
            .map(|inner| inner.prepare_transition(transition_id, protocol_version));

        if let Some(Err(_)) = prepare_result {
            self.reinitializing = true;
            self.clear_transitions();
            return false;
        }

        self.pending_transitions.insert(
            transition_id,
            PendingTransition {
                version: protocol_version,
                expires_at: Instant::now() + TRANSITION_TIMEOUT,
            },
        );

        if protocol_version == 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(
                    true,
                    Some(TRANSITION_EXPIRY_PENDING_DOWNGRADE),
                );
            }
        }

        if transition_id == 0 {
            // davey уже применил transition_id == 0 внутри prepare_transition;
            // здесь обновляем только состояние обёртки.
            let _ = self.execute_transition(0);
            false
        } else {
            true
        }
    }

    // ---------------------------------------------------------------------
    // Execute transition
    // ---------------------------------------------------------------------

    /// Выполняет ранее зарегистрированный переход.
    ///
    /// Для ненулевого `transition_id` сначала выполняется переход в `davey`,
    /// после чего обновляется состояние обёртки. В отличие от старого API,
    /// смена версии здесь не должна вызывать `reinit`: это сбросило бы группу,
    /// commit/welcome которой уже обработаны.
    #[inline]
    pub fn execute_transition(&mut self, transition_id: u16) -> bool {
        self.expire_transitions();

        if self.is_transitioning {
            return false;
        }

        let version = match self.pending_transitions.get(&transition_id) {
            Some(pending) => pending.version,
            None => return false,
        };

        self.is_transitioning = true;

        // Для ненулевых id davey ожидает, что до этого был вызван
        // DaveSession::prepare_transition. id == 0 уже применён этим вызовом.
        if transition_id != 0 {
            let execution_result = self
                .inner
                .as_mut()
                .map(|inner| inner.execute_transition(transition_id));

            match execution_result {
                // Нативной сессии нет: на версию 0 (E2EE выключается) нечего
                // выполнять, а на версию > 0 переход невозможен без сессии.
                None if version == 0 => {}
                
                Some(Ok(true)) => {}
                Some(Ok(false)) | None => {
                    self.is_transitioning = false;
                    return false;
                }
                Some(Err(_)) => {
                    self.is_transitioning = false;
                    self.reinitializing = true;
                    self.clear_transitions();
                    return false;
                }
            }
        }

        let old_version = self.version;
        self.version = version;

        if old_version != 0 && self.version == 0 {
            self.downgraded = true;
        }

        if self.downgraded && self.version > 0 {
            if let Some(inner) = self.inner.as_mut() {
                inner.set_passthrough_mode(true, Some(TRANSITION_EXPIRY));
            }
            self.downgraded = false;
        }

        self.last_transition_id = Some(transition_id);
        self.pending_transitions.remove(&transition_id);
        self.is_transitioning = false;

        true
    }

    // ---------------------------------------------------------------------
    // Encrypt
    // ---------------------------------------------------------------------

    /// Шифрует Opus-пакеты.
    ///
    /// Возвращает зашифрованные пакеты и число тех, что отправить нельзя.
    /// Если шифрование невозможно в принципе (версия 0, идёт переход или
    /// повторная инициализация, сессия не готова) — не зашифровано ничего.
    /// Если не удался один пакет, остальные всё равно шифруются: потеря
    /// одного кадра лучше потери всей пачки.
    ///
    /// # Аргументы
    /// * `packets` — исходные Opus-пакеты.
    #[inline]
    pub fn encrypt(&mut self, packets: Vec<Vec<u8>>) -> (Vec<Vec<u8>>, usize) {
        let total = packets.len();

        // Passthrough-режим или нестабильное состояние — не шифруем.
        if self.version == 0 || self.is_transitioning || self.reinitializing {
            return (Vec::new(), total);
        }

        let Some(inner) = self.inner.as_mut() else {
            return (Vec::new(), total);
        };

        // Сессия ещё не готова к шифрованию.
        if !inner.is_ready() {
            return (Vec::new(), total);
        }

        let mut output = Vec::with_capacity(total);
        for packet in packets {
            // Нативный encrypt_opus может паниковать — перехватываем.
            let encrypted = std::panic::catch_unwind(
                std::panic::AssertUnwindSafe(|| inner.encrypt_opus(&packet))
            );

            if let Ok(Ok(buffer)) = encrypted {
                output.push(buffer.to_vec());
            }
        }

        let failed = total - output.len();
        (output, failed)
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
        self.pending_transitions.retain(|_, transition| {
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
        MlsError::from_reason(format!("[MlsSession] {}", error))
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
        // Пытаемся распарсить число; при ошибке подставляем имя поля.
        id.parse().map_err(|_| {
            MlsError::from_reason(format!("Invalid {}: {}", name, id))
        })
    }

    /// Преобразует числовой код операции в enum `davey`.
    ///
    /// 0 — APPEND; 1 — REVOKE.
    #[inline]
    fn map_operation(operation: u8) -> Result<davey::ProposalsOperationType> {
        match operation {
            0 => Ok(davey::ProposalsOperationType::APPEND),
            1 => Ok(davey::ProposalsOperationType::REVOKE),
            _ => Err(MlsError::from_reason(format!("Invalid operation: {operation}"))),
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
    fn destroy_sets_destroyed_and_clears_state() {
        let mut s = session_v1();
        s.pending_transitions.insert(1, PendingTransition {
            version: 1,
            expires_at: Instant::now() + Duration::from_secs(60),
        });
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
    fn destroy_is_idempotent() {
        let mut s = session_v1();
        s.destroy();
        s.destroy();
        assert!(s.destroyed());
    }

    #[test]
    fn destroyed_short_circuits_prepare_epoch() {
        let mut s = session_v1();
        s.destroy();
        assert!(s.prepare_epoch(1, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    #[test]
    fn destroyed_short_circuits_reinit() {
        let mut s = session_v1();
        s.destroy();
        assert!(s.reinit().unwrap().is_none());
    }

    // ---------------------------------------------------------------------
    // parse_id
    // ---------------------------------------------------------------------

    #[test]
    fn parse_id_accepts_valid_numbers() {
        assert_eq!(MlsSession::parse_id("123", "user id").unwrap(), 123);
        assert_eq!(MlsSession::parse_id("0", "user id").unwrap(), 0);
        assert_eq!(
            MlsSession::parse_id("18446744073709551615", "user id").unwrap(),
            u64::MAX,
        );
    }

    #[test]
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
    fn map_operation_accepts_0_and_1() {
        assert_eq!(
            MlsSession::map_operation(0).unwrap(),
            davey::ProposalsOperationType::APPEND,
        );
        assert_eq!(
            MlsSession::map_operation(1).unwrap(),
            davey::ProposalsOperationType::REVOKE,
        );
    }

    #[test]
    fn map_operation_rejects_unknown() {
        assert!(MlsSession::map_operation(2).is_err());
        assert!(MlsSession::map_operation(255).is_err());
    }

    // ---------------------------------------------------------------------
    // map_err
    // ---------------------------------------------------------------------

    #[test]
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
    fn prepare_transition_with_nonzero_id_defers() {
        let mut s = session_v0();
        assert!(s.prepare_transition(5, 1));
        assert_eq!(s.pending_transitions.len(), 1);
        assert!(!s.is_transitioning);
        assert_eq!(s.last_transition_id(), None);
        assert_eq!(s.version, 0);
    }

    #[test]
    fn prepare_transition_with_zero_id_executes_immediately() {
        let mut s = session_v0();
        assert!(!s.prepare_transition(0, 0));
        assert_eq!(s.last_transition_id(), Some(0));
        assert!(s.pending_transitions.is_empty());
    }

    #[test]
    fn execute_transition_with_unknown_id_returns_false() {
        let mut s = session_v1();
        assert!(!s.execute_transition(42));
        assert_eq!(s.last_transition_id(), None);
    }

    #[test]
    fn execute_transition_with_registered_id_succeeds() {
        let mut s = session_v0();
        s.prepare_transition(7, 0);
        assert!(s.execute_transition(7));
        assert_eq!(s.last_transition_id(), Some(7));
        assert!(s.pending_transitions.is_empty());
        assert!(!s.is_transitioning);
    }

    #[test]
    fn execute_transition_downgrade_to_zero_sets_flag() {
        let mut s = session_v1();
        s.prepare_transition(3, 0);
        assert!(s.execute_transition(3));
        assert_eq!(s.version, 0);
        assert!(s.downgraded);
    }

    #[test]
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
    fn prepare_epoch_ignores_epoch_zero() {
        let mut s = session_v1();
        assert!(s.prepare_epoch(0, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    #[test]
    fn prepare_epoch_ignores_non_first_epoch() {
        let mut s = session_v1();
        assert!(s.prepare_epoch(2, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    #[test]
    fn prepare_epoch_skipped_while_reinitializing() {
        let mut s = session_v1();
        s.reinitializing = true;
        assert!(s.prepare_epoch(1, 5).unwrap().is_none());
        assert_eq!(s.version, 1);
    }

    // ---------------------------------------------------------------------
    // reinit
    // ---------------------------------------------------------------------

    #[test]
    fn reinit_version_zero_without_session_returns_none() {
        let mut s = session_v0();
        assert!(s.reinit().unwrap().is_none());
        assert!(s.inner.is_none());
    }

    // ---------------------------------------------------------------------
    // encrypt (без данных — только короткое замыкание)
    // ---------------------------------------------------------------------

    /// Если шифрование невозможно, все пакеты считаются непереданными.
    fn assert_all_failed(s: &mut MlsSession) {
        let (out, failed) = s.encrypt(vec![vec![1], vec![2], vec![3]]);
        assert!(out.is_empty());
        assert_eq!(failed, 3);
    }

    #[test]
    fn encrypt_version_zero_fails_all() {
        assert_all_failed(&mut session_v0());
    }

    #[test]
    fn encrypt_without_session_fails_all() {
        assert_all_failed(&mut session_v1());
    }

    #[test]
    fn encrypt_while_transitioning_fails_all() {
        let mut s = session_v1();
        s.is_transitioning = true;
        assert_all_failed(&mut s);
    }

    #[test]
    fn encrypt_while_reinitializing_fails_all() {
        let mut s = session_v1();
        s.reinitializing = true;
        assert_all_failed(&mut s);
    }

    #[test]
    fn encrypt_empty_batch_is_not_a_failure() {
        let (out, failed) = session_v1().encrypt(Vec::new());
        assert!(out.is_empty());
        assert_eq!(failed, 0);
    }

    // ---------------------------------------------------------------------
    // set_passthrough_mode без сессии
    // ---------------------------------------------------------------------

    #[test]
    fn set_passthrough_mode_without_session_is_noop() {
        let mut s = session_v1();
        s.set_passthrough_mode(true, Some(10));
        assert!(s.inner.is_none());
    }
}
