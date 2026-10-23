use crate::structures::timers::scheduler::constants::{
    MAX_SPIN_MARGIN, MIN_SPIN_MARGIN, TARGET_SPIN_TIME, TIMER_RESOLUTION,
};
use crate::structures::timers::scheduler::telemetry::SchedulerTelemetry;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// Результат ожидания дедлайна.
pub struct WaitOutcome {
    /// Достигнут ли дедлайн.
    ///
    /// `false` — воркер остановлен или пересоздан (сменилось поколение),
    /// даже если по времени мы уже за дедлайном. Отмена имеет приоритет
    /// над дедлайном: если воркера больше нет, «проснуться вовремя»
    /// бессмысленно.
    pub reached_deadline: bool,

    /// Сколько времени провели в активном спине. Идёт в телеметрию,
    /// по которой `adapt_margin` подстраивает `spin_margin`.
    pub spin_time: Duration,

    /// Насколько пробуждение после `sleep` опоздало относительно
    /// дедлайна. Тоже метрика для `adapt_margin`: чем больше overshoot,
    /// тем больше нужен `spin_margin`, чтобы успевать до дедлайна
    /// в следующий раз.
    pub sleep_overshoot: Duration,
}

/// Высокоточный таймер с гибридной стратегией ожидания (async-версия).
///
/// Три режима в зависимости от оставшегося времени до дедлайна:
/// 1. **Глубокий сон** — `tokio::time::sleep` / `Notify`. Отдаём управление ОС;
///    пробуждение с точностью ~1 мс (granularity планировщика).
/// 2. **Кооперативная уступка** — `tokio::task::yield_now().await`. Даём
///    runtime'у выполнить другие задачи, но не уходим в сон.
/// 3. **Активный спин** — `std::hint::spin_loop` в последние `spin_margin`.
///    Точность до сотен наносекунд ценой CPU.
///
/// Порядок важен: спим, пока далеко; yield'им, пока близко; спин'им
/// в самом хвосте. Так мы платим CPU только там, где он действительно
/// нужен для точности.
pub struct PrecisionTimer;

impl PrecisionTimer {
    /// Ожидает наступления `deadline`, комбинируя сон, yield и spin.
    ///
    /// # Аргументы
    /// * `deadline` — момент времени (`std::time::Instant`).
    /// * `current_generation` — текущее поколение воркера (0 = остановлен).
    /// * `my_generation` — поколение, к которому привязан этот вызов.
    /// * `wake` — shared `Notify` для досрочного пробуждения.
    /// * `telemetry` — метрики, из которых читается текущий `spin_margin`.
    pub async fn wait_until(deadline: Instant, current_generation: &AtomicU64, my_generation: u64, wake: &Notify, telemetry: &SchedulerTelemetry) -> WaitOutcome {
        let mut spin_time = Duration::ZERO;
        let mut sleep_overshoot = Duration::ZERO;

        let spin_margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));

        // Порог для «глубокого сна». Пока остаётся больше `2 * spin_margin`,
        // спим — это даёт запас на overshoot сна (~1 мс) и оставляет
        // хотя бы `spin_margin` на yield + сам спин.
        //
        // Почему именно 2x, а не 1x: после пробуждения от sleep мы можем
        // оказаться в любой точке `[deadline - spin_margin, deadline]`,
        // и если сразу перейдём к спину, точность будет ниже, чем если
        // сначала сделать yield (он короче сна и не так сильно
        // «размазывает» пробуждение). 2x гарантирует, что на yield
        // останется хотя бы `spin_margin`.
        // Порог ухода со `sleep` на yield/спин. Не меньше `margin + 1 мс`:
        // `sleep` tokio округляется вверх до 1 мс, и при малом `margin`
        // (например, 200 мкс) пробуждение могло случиться ПОСЛЕ дедлайна,
        // тик опаздывал на сотни микросекунд, и точность зависела от
        // того, с каким `margin` стартовал воркер.
        let yield_threshold = (spin_margin * 2).max(spin_margin + TIMER_RESOLUTION);

        // `Acquire` — потому что `current_generation` пишется под
        // `Release` (в `Scheduler`); нам нужно увидеть всё, что было
        // опубликовано до смены поколения.
        let is_running = || current_generation.load(Ordering::Acquire) == my_generation;

        loop {
            // Проверка отмены — самая первая. Если воркер остановлен
            // или пересоздан, дальнейшее ожидание бессмысленно,
            // даже если дедлайн уже прошёл.
            if !is_running() {
                return WaitOutcome {
                    reached_deadline: false,
                    spin_time,
                    sleep_overshoot,
                };
            }

            let now = Instant::now();
            if now >= deadline {
                return WaitOutcome {
                    reached_deadline: true,
                    spin_time,
                    sleep_overshoot,
                };
            }

            let remaining = deadline.duration_since(now);

            // Глубокий сон (OS Sleep).
            if remaining >= yield_threshold {
                let timeout = remaining - yield_threshold;

                // `select!`: либо проспим `timeout`, либо нас разбудят
                // через `wake` (например, при добавлении сессии в воркер
                // или при shutdown). Второй вариант нужен, чтобы не ждать
                // весь `timeout`, если воркер надо остановить сейчас.
                tokio::select! {
                    _ = tokio::time::sleep(timeout) => {},
                    _ = wake.notified() => {},
                }

                let after_wait = Instant::now();
                if after_wait > deadline {
                    sleep_overshoot = after_wait.duration_since(deadline);
                }

                // `continue`, а не `return`: перечитываем `is_running()`
                // в начале цикла. Если во время сна нас отменили,
                // `reached_deadline` должен быть `false`, а не `true`,
                // даже если по времени мы уже за дедлайном. Отмена
                // имеет приоритет над дедлайном.
                continue;
            }

            // Осталось больше `spin_margin`, но меньше `2 * spin_margin`:
            // спин слишком расточителен, сон слишком неточен. `yield_now`
            // даёт управление runtime'у, но возвращается быстро.
            if remaining >= spin_margin {
                tokio::task::yield_now().await;
                continue;
            }

            // Осталось не больше `spin_margin` — точность важнее CPU.
            //
            // `<= deadline`, а не `< deadline`: выходим, когда строго
            // прошли дедлайн, чтобы не вернуться за наносекунду до него.
            //
            // `std::hint::spin_loop()` — подсказка процессору, что мы
            // в spin-wait (`pause` на x86). Не блокирует runtime
            // и не переключает задачу — это и есть цель спинящей
            // фазы: остаться на текущем worker-thread.
            let spin_start = Instant::now();
            while Instant::now() <= deadline {
                if !is_running() {
                    spin_time += spin_start.elapsed();
                    return WaitOutcome {
                        reached_deadline: false,
                        spin_time,
                        sleep_overshoot,
                    };
                }
                std::hint::spin_loop();
            }

            spin_time += spin_start.elapsed();
            return WaitOutcome {
                reached_deadline: true,
                spin_time,
                sleep_overshoot,
            };
        }
    }

    /// Адаптирует `spin_margin` по накопленной телеметрии.
    ///
    /// Логика:
    /// * если пробуждение после сна опаздывает (overshoot > 0) —
    ///   увеличиваем `spin_margin`, чтобы в следующий раз начать
    ///   спин раньше и не зависеть от granularity сна;
    /// * если спин слишком длинный (`avg_spin >= TARGET_SPIN_TIME`) —
    ///   уменьшаем, тратим слишком много CPU;
    /// * если спин слишком короткий (`avg_spin <= TARGET_SPIN_TIME / 2`) —
    ///   увеличиваем, точность страдает.
    ///
    /// Шаг ограничен `old_margin / 10` (или 100 нс), чтобы
    /// `spin_margin` не «прыгал» от одного измерения к другому.
    #[inline]
    pub fn adapt_margin(state: &SchedulerTelemetry, avg_spin: Duration, avg_overshoot: Duration) {
        let old_margin = Duration::from_nanos(state.spin_margin_ns.load(Ordering::Relaxed));
        let granularity =
            Duration::from_nanos(state.sleep_granularity_ns.load(Ordering::Relaxed));

        // Минимальный `spin_margin`: удвоенная granularity сна — иначе
        // спин не успеет «накрыть» промах сна, и мы всё равно
        // проснёмся с overshoot'ом. Ограничен снизу `MIN_SPIN_MARGIN`
        // и сверху `MAX_SPIN_MARGIN`.
        let min_margin = granularity
            .saturating_mul(2)
            .max(MIN_SPIN_MARGIN)
            .min(MAX_SPIN_MARGIN);

        let mut target = old_margin;

        // Overshoot — прямой сигнал «спин был слишком коротким».
        // Растём на половину overshoot'а: полный overshoot сделал бы
        // спин неоправданно длинным на следующем цикле.
        if avg_overshoot >= Duration::ZERO {
            target = target.saturating_add(avg_overshoot / 2);
        }

        // Спин слишком длинный — сжимаем целевое значение на половину
        // избытка. Полный избыток мог бы «перелететь» в недостаток.
        if avg_spin >= TARGET_SPIN_TIME {
            target = target.saturating_sub((avg_spin - TARGET_SPIN_TIME) / 2);
        } else if avg_spin <= TARGET_SPIN_TIME / 2 {
            // Спин сильно меньше целевого — вероятно, точность
            // страдает из-за слишком маленького `spin_margin`.
            // Растём, но опять же вполовину.
            target = target.saturating_add((TARGET_SPIN_TIME / 2 - avg_spin) / 2);
        }

        // Ограничиваем шаг: `old_margin / 10`, но не меньше 100 нс.
        // Без этого одно шумное измерение могло бы увести `spin_margin`
        // в крайность, и следующие тики потратили бы на восстановление.
        let max_change = (old_margin / 10).max(Duration::from_nanos(100));
        let step = old_margin.abs_diff(target).min(max_change);
        let adjusted = if target >= old_margin {
            old_margin + step
        } else {
            old_margin - step
        };

        // Финальный clamp: `spin_margin` всегда в `[min_margin, MAX_SPIN_MARGIN]`.
        // `min_margin` включает granularity — если она вдруг стала больше
        // `MAX_SPIN_MARGIN`, clamp не даст уйти за верхнюю границу.
        state.spin_margin_ns.store(
            adjusted.clamp(min_margin, MAX_SPIN_MARGIN).as_nanos() as u64,
            Ordering::Relaxed,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    fn telemetry_with_margin(margin: Duration, granularity: Duration) -> SchedulerTelemetry {
        let telemetry = SchedulerTelemetry::default();
        telemetry
            .spin_margin_ns
            .store(margin.as_nanos() as u64, Ordering::Relaxed);
        telemetry
            .sleep_granularity_ns
            .store(granularity.as_nanos() as u64, Ordering::Relaxed);
        telemetry
    }

    #[test]
    // Overshoot сна — спин нужно удлинить.
    fn adapt_margin_increases_on_sleep_overshoot() {
        let telemetry = telemetry_with_margin(Duration::from_micros(300), Duration::ZERO);
        PrecisionTimer::adapt_margin(
            &telemetry,
            TARGET_SPIN_TIME,
            Duration::from_micros(100),
        );
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(new_margin > Duration::from_micros(300));
    }

    #[test]
    // Спин сильно длиннее целевого — сжимаем.
    fn adapt_margin_decreases_when_spin_too_long() {
        let telemetry = telemetry_with_margin(Duration::from_micros(300), Duration::ZERO);
        PrecisionTimer::adapt_margin(&telemetry, TARGET_SPIN_TIME * 4, Duration::ZERO);
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(new_margin < Duration::from_micros(300));
    }

    #[test]
    // Верхняя граница жёсткая: сколько ни увеличивай, MAX_SPIN_MARGIN не перепрыгнуть.
    fn adapt_margin_never_exceeds_max() {
        let telemetry = telemetry_with_margin(MAX_SPIN_MARGIN, Duration::ZERO);
        for _ in 0..50 {
            PrecisionTimer::adapt_margin(&telemetry, Duration::ZERO, Duration::from_secs(1));
        }
        let margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(margin <= MAX_SPIN_MARGIN);
    }

    #[test]
    // Нижняя граница привязана к granularity сна: `2 * granularity`.
    fn adapt_margin_respects_granularity_based_min() {
        let granularity = MIN_SPIN_MARGIN;
        let telemetry = telemetry_with_margin(MIN_SPIN_MARGIN, granularity);
        for _ in 0..50 {
            PrecisionTimer::adapt_margin(&telemetry, TARGET_SPIN_TIME * 10, Duration::ZERO);
        }
        let margin = Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        assert!(margin >= granularity.saturating_mul(2).min(MAX_SPIN_MARGIN));
    }

    #[test]
    // Шаг ограничен: `old/10`, но не меньше 100 нс. Без этого
    // одно измерение могло бы увести `spin_margin` в крайность.
    fn adapt_margin_step_is_bounded() {
        let telemetry = telemetry_with_margin(Duration::from_micros(500), Duration::ZERO);
        PrecisionTimer::adapt_margin(&telemetry, Duration::ZERO, Duration::from_secs(1));
        let new_margin =
            Duration::from_nanos(telemetry.spin_margin_ns.load(Ordering::Relaxed));
        let max_expected_step = Duration::from_micros(50).max(Duration::from_nanos(100));
        assert!(new_margin <= Duration::from_micros(500) + max_expected_step);
    }

    #[tokio::test]
    // Дедлайн в прошлом — возврат сразу, без сна и спина.
    async fn wait_until_returns_immediately_for_past_deadline() {
        let generation = AtomicU64::new(1);
        let wake = Notify::new();
        let telemetry = SchedulerTelemetry::default();

        let outcome = PrecisionTimer::wait_until(
            Instant::now() - Duration::from_millis(1),
            &generation,
            1,
            &wake,
            &telemetry,
        )
            .await;

        assert!(outcome.reached_deadline);
    }

    #[tokio::test]
    // Смена поколения во время сна — возврат с `reached_deadline = false`,
    // даже если после пробуждения мы уже за дедлайном. Отмена важнее.
    async fn wait_until_stops_when_generation_changes() {
        let generation = Arc::new(AtomicU64::new(1));
        let wake = Arc::new(Notify::new());
        let telemetry = SchedulerTelemetry::default();

        let generation_clone = Arc::clone(&generation);
        let wake_clone = Arc::clone(&wake);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            generation_clone.store(0, Ordering::Release);
            wake_clone.notify_waiters();
        });

        let deadline = Instant::now() + Duration::from_millis(500);
        let outcome = PrecisionTimer::wait_until(
            deadline, &generation, 1, &wake, &telemetry,
        )
            .await;

        assert!(!outcome.reached_deadline);
    }
}