import type { RestAPINames } from "#handler/rest/index.abstract.js";
import { env } from "#db/env";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Эмодзи в качестве дизайнерского решения
 * @private
 */
const emoji = {
    /**
     * @description Пустой прогресс бар
     */
    empty: initElement("empty"),

    /**
     * @description Не пустой прогресс бар
     */
    upped: initElement("not_empty")
};

/**
 * @author SNIPPIK
 * @description Все найденные кнопки платформ
 * @private
 */
let buttons: { [key: string]: string; } = null;

/**
 * @author SNIPPIK
 * @description Кэш резолва кнопки платформы по названию, чтобы не пересобирать
 * шаблонную строку `button_${platform}` и не звать `toLowerCase()` на каждый
 * вызов `bar()`. Число платформ конечно и невелико, кэш никогда не разрастётся.
 * @private
 */
const buttonResolveCache = new Map<string, string>();

/**
 * Класс для формирования визуального прогресс-бара трека с использованием
 * кастомных эмодзи (левая/центральная/правая части) и кнопки платформы.
 *
 * Оптимизирован для многократного вызова `bar()` в горячем цикле обновления UI:
 * - все неизменяемые строки (полностью пустой/заполненный бары, шаблон live)
 *   собираются один раз в конструкторе;
 * - прямые ссылки на строки эмодзи исключают лишние обращения к объектам;
 * - все возможные варианты `repeat(0..size)` для заполненного и пустого
 *   сегментов предпосчитаны в конструкторе, поэтому `bar()` никогда не вызывает
 *   `.repeat()` — только индексирует готовый массив;
 * - резолв кнопки платформы кэшируется, чтобы не пересобирать строку и не
 *   звать `toLowerCase()` на каждый вызов;
 * - условные вычисления выполняются только при частичном заполнении.
 *
 * @example
 * ```ts
 * const progress = new PlayerProgress(20);
 * const bar = progress.bar({
 *   duration: { current: 30_000, total: 180_000 },
 *   platform: 'YOUTUBE'
 * });
 * ```
 */
export class PlayerProgress {
    /**
     * Левая граница пустого бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly emptyLeft: string;

    /**
     * Центральный сегмент пустого бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly emptyCenter: string;

    /**
     * Правая граница пустого бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly emptyRight: string;

    /**
     * Левая граница заполненного бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly uppedLeft: string;

    /**
     * Центральный сегмент заполненного бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly uppedCenter: string;

    /**
     * Правая граница заполненного бара (эмодзи).
     * Кэшированная ссылка на строку.
     */
    private readonly uppedRight: string;

    /**
     * Полностью пустой прогресс-бар (все сегменты пустые).
     * Собирается один раз в конструкторе.
     */
    private readonly emptyBar: string;

    /**
     * Полностью заполненный прогресс-бар (все сегменты заполненные).
     * Собирается один раз в конструкторе.
     */
    private readonly fullBar: string;

    /**
     * Центральная часть пустого бара для live-режима (без правого края).
     * Длина = `size - 1`; используется при total = 0 или Infinity.
     */
    private readonly liveEmptyCenter: string;

    /**
     * Предпосчитанные варианты `uppedCenter.repeat(n)` для n = 0..size.
     * Индексируется напрямую в `bar()`, чтобы не звать `.repeat()`
     * в горячем цикле обновления прогресс-бара.
     */
    private readonly uppedCenterCache: string[];

    /**
     * Предпосчитанные варианты `emptyCenter.repeat(n)` для n = 0..size.
     * Индексируется напрямую в `bar()`, чтобы не звать `.repeat()`
     * в горячем цикле обновления прогресс-бара.
     */
    private readonly emptyCenterCache: string[];

    /**
     * Создаёт экземпляр генератора прогресс-бара.
     *
     * @param size - Количество центральных сегментов бара (ширина).
     *               По умолчанию 15. Определяет точность отображения прогресса.
     */
    constructor(private size: number = 15) {
        // Прямые ссылки на эмодзи для максимальной скорости доступа.
        this.emptyLeft   = emoji.empty.left;
        this.emptyCenter = emoji.empty.center;
        this.emptyRight  = emoji.empty.right;
        this.uppedLeft   = emoji.upped.left;
        this.uppedCenter = emoji.upped.center;
        this.uppedRight  = emoji.upped.right;

        // Предварительная сборка статических шаблонов.
        this.emptyBar = this.emptyLeft + this.emptyCenter.repeat(size) + this.emptyRight;
        this.fullBar  = this.uppedLeft + this.uppedCenter.repeat(size) + this.uppedRight;
        this.liveEmptyCenter = this.emptyCenter.repeat(size - 1);

        // Предпосчитанные таблицы repeat(0..size): в bar() возможные значения
        // filled/emptyCount всегда лежат в этом диапазоне, поэтому вместо
        // конкатенации на каждый вызов делаем один просчёт при создании класса.
        this.uppedCenterCache = Array.from({ length: size + 1 }, (_, n) => this.uppedCenter.repeat(n));
        this.emptyCenterCache = Array.from({ length: size + 1 }, (_, n) => this.emptyCenter.repeat(n));
    }

    /**
     * Генерирует строку прогресс-бара на основе текущей позиции трека и платформы.
     *
     * Логика формирования:
     * - **Live / неизвестная длительность** (total = 0 или Infinity):
     *   отображается левая заполненная граница + кнопка платформы + пустые центральные сегменты
     *   (без правой заполненной границы).
     * - **Трек не начинался** (current ≤ 0): возвращается полностью пустой бар.
     * - **Трек завершён** (current ≥ total): возвращается полностью заполненный бар.
     * - **Промежуточное состояние**: вычисляется количество заполненных центральных сегментов,
     *   вставляется кнопка платформы, оставшееся место заполняется пустыми сегментами.
     *
     * Кнопка платформы выбирается по полю `platform` из глобального объекта `buttons`,
     * который лениво инициализируется при первом вызове, а результат резолва
     * кэшируется в `buttonResolveCache`, чтобы не пересобирать строку и не
     * звать `toLowerCase()` при каждом вызове. Если платформа не указана
     * или не найдена, используется кнопка по умолчанию (`"button"`).
     *
     * @param input - Объект с данными трека.
     * @param input.duration.current - Текущая позиция воспроизведения (в мс).
     * @param input.duration.total   - Общая длительность трека (в мс).
     * @param input.platform         - Идентификатор платформы (например, `"youtube"`).
     *
     * @returns Строка прогресс-бара, готовая для отображения в сообщении.
     */
    public bar = ({ duration: { current, total }, platform }: PlayerProgressInput): string => {
        // Ленивая инициализация глобального реестра кнопок платформ.
        if (!buttons) initButtons();
        const button = resolveButton(platform);

        // Live-режим: общая длительность неизвестна или бесконечна.
        if (total === 0 || total === Infinity) {
            return this.uppedLeft + button + this.liveEmptyCenter + this.emptyRight;
        }

        // Воспроизведение не начиналось.
        if (current <= 0) {
            return this.emptyBar;
        }

        // Воспроизведение завершено.
        if (current >= total) {
            return this.fullBar;
        }

        // Частичное заполнение. Расчёт количества заполненных и пустых сегментов.
        //    `-1` резервирует одно место под кнопку платформы.
        const filled = Math.floor(this.size * (current / total));
        const emptyCount = this.size - filled - 1;

        // Сборка строки: левая заполненная граница + заполненные сегменты +
        // кнопка + пустые сегменты + правая пустая граница.
        // uppedCenterCache/emptyCenterCache уже содержат нужные repeat-строки —
        // индексируем вместо вызова .repeat() на каждый тик.
        return this.uppedLeft +
            this.uppedCenterCache[filled] +
            button +
            this.emptyCenterCache[emptyCount] +
            this.emptyRight;
    };
}

/**
 * @author SNIPPIK
 * @description Данные для создания прогресс бара
 * @interface PlayerProgressInput
 * @private
 */
interface PlayerProgressInput {
    /** Название платформы */
    platform: RestAPINames;

    /** Данные о времени трека */
    duration: {
        /** Текущее время */
        current: number;

        /** Общее время */
        total: number
    };
}

/**
 * @author SNIPPIK
 * @description Доступные элементы для создания прогресс бара
 * @type Elements
 * @private
 */
type Elements = "left" | "center" | "right";

/**
 * @author SNIPPIK
 * @description Получение списка для создания прогресс бара
 * @param type - Тип элемента
 * @private
 */
function initElement(type: "empty" | "not_empty") {
    const keys = ["left", "center", "right"];
    return keys.reduce((acc, key) => {
        acc[key] = env.get(`progress.${type}.${key}`);
        return acc;
    }, {} as Record<Elements, string>);
}

/**
 * @author SNIPPIK
 * @description Функция для отложенной загрузки кнопок
 * @function initButtons
 * @private
 */
function initButtons() {
    buttons = db.api.array.reduce((acc, api) => {
        const platform = `${api.name}`.toLowerCase();
        const inEnv = env.get(`progress.button.${platform}`, null);

        if (inEnv) acc[`button_${platform}`] = inEnv;
        return acc;
    }, {
        button: env.get("progress.button"),
    });
}

/**
 * @author SNIPPIK
 * @description Резолвит кнопку платформы с кэшированием результата,
 * чтобы не пересобирать шаблонную строку и не звать `toLowerCase()`
 * на каждый вызов `bar()`. Число уникальных платформ конечно и невелико,
 * поэтому кэш безопасен и никогда не разрастётся заметно.
 * @param platform - Название платформы (может быть undefined)
 * @private
 */
function resolveButton(platform: string | undefined): string {
    const key = platform ?? "";
    let cached = buttonResolveCache.get(key);

    if (cached === undefined) {
        cached = buttons[`button_${key.toLowerCase()}`] ?? buttons["button"];
        buttonResolveCache.set(key, cached);
    }

    return cached;
}