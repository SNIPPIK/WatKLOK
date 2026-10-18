use std::{fmt, time::Instant};

/// Ошибка MLS-сессии (текстовая причина, как раньше у napi-ошибки).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsError {
  reason: String,
}

impl MlsError {
  /// Создаёт ошибку из текста.
  pub fn from_reason(reason: impl Into<String>) -> Self {
    Self { reason: reason.into() }
  }

  /// Текст ошибки.
  pub fn reason(&self) -> &str {
    &self.reason
  }
}

impl fmt::Display for MlsError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(&self.reason)
  }
}

impl std::error::Error for MlsError {}

/// Результат операций MLS-сессии.
pub type Result<T> = std::result::Result<T, MlsError>;

/// Результат обработки proposals: commit и опциональный welcome.
///
/// Возвращается из `process_proposals`. Поле `commit` присутствует, если
/// нативная сессия сформировала новый commit для группы; `welcome` — только
/// если в группу добавляются новые участники и им нужно приглашение.
#[derive(Debug, Clone, Default)]
pub struct ProposalsResult {
  /// Данные commit. `None`, если commit не требуется.
  pub commit: Option<Vec<u8>>,

  /// Данные welcome. `None`, если новых участников нет.
  pub welcome: Option<Vec<u8>>,
}

/// Результат обработки commit или welcome.
///
/// Возвращается из `process_commit` и `process_welcome`.
#[derive(Debug, Clone, Copy)]
pub struct TransitionResult {
  /// Идентификатор перехода (первые 2 байта payload).
  pub transition_id: u16,

  /// `true`, если обработка завершилась успешно.
  pub success: bool,

  /// `true`, если переход признан невалидным и требует повторной инициализации.
  /// Устанавливается только при первой ошибке; повторные ошибки во время
  /// уже начатой повторной инициализации сигнал не выставляют.
  pub invalidated: bool,
}

/// Запись об ожидаемом переходе.
///
/// Хранится в `pending_transitions` до момента вызова `execute_transition`
/// или до истечения `expires_at`, после чего удаляется через
/// `expire_transitions`.
pub struct PendingTransition {
  /// Целевая версия протокола, которая будет применена при выполнении перехода.
  pub(crate) version: u16,

  /// Момент времени, после которого запись считается устаревшей.
  /// Вычисляется как `Instant::now() + TRANSITION_TIMEOUT`.
  pub(crate) expires_at: Instant,
}