import { TRACK_CHECK_WAIT } from "#core/queue/controllers/provider.js";
import { AudioResource } from "#core/audio/index.js";
import { db } from "#db";

/**
 * Управляет жизненным циклом аудиопотоков в плеере: текущим воспроизведением,
 * пред загрузкой, таймаутами и индикацией громкости.
 *
 * Класс оптимизирован для частых обращений:
 * - индикатор громкости кэшируется в строковом виде и пересчитывается только при изменении громкости;
 * - признак наличия пред загруженного потока хранится в явном поле, а не вычисляется динамически;
 * - прямые проверки и отсутствие избыточных вызовов ускоряют горячий путь.
 *
 * @typeParam T - Тип аудио ресурса, расширяющий `AudioResource`.
 *
 * @example
 * ```ts
 * const audio = new PlayerAudio<MyStream>();
 * audio.volume = 85;                      // устанавливает громкость и индикатор
 * audio.preload = new MyStream(...);      // запускает пред загрузку
 * console.log(audio.volumeIndicator);     // "🔊 85%"
 * ```
 */
export class PlayerAudio<T extends AudioResource> {
    /** Все созданные ресурсы */
    private _streams: T[] = [];

    /**
     * Текущая громкость (целое число, диапазон 10..200).
     * Инициализируется глобальной настройкой из хранилища конфигурации.
     */
    private _volume = db.queues.options.volume;

    /**
     * Кешированная строка индикатора громкости (эмодзи + значение).
     * Пересчитывается только при изменении `_volume`.
     */
    private _volumeIndicator: string;

    /** Таймер чтения аудио потока, для авто удаления */
    private _timeout: NodeJS.Timeout | null;

    /**
     * Создаёт экземпляр менеджера аудио.
     * Вычисляет начальный индикатор громкости на основе значения по умолчанию.
     */
    public constructor() {
        this._updateVolumeIndicator();
    };

    /**
     * Устанавливает громкость и обновляет кэшированный текстовый индикатор.
     *
     * Значение автоматически ограничивается диапазоном **[10, 200]**:
     * - меньше 10 → 10 (почти беззвучно, но не 0);
     * - больше 200 → 200 (максимальное усиление).
     *
     * @param volume - Новый уровень громкости (целое число).
     */
    public set volume(volume: number) {
        this._volume = volume > 200 ? 200 : volume < 10 ? 10 : volume;
        this._updateVolumeIndicator();
    };

    /** Текущий уровень громкости (10..200). */
    public get volume(): number {
        return this._volume;
    };

    /**
     * Кешированный индикатор громкости в формате `"🔉 85%"`.
     * Обновляется синхронно при изменении `volume`.
     */
    public get volumeIndicator(): string {
        return this._volumeIndicator;
    };

    /** Активный аудиопоток или `null`, если ничего не воспроизводится. */
    public get current(): T | null {
        const length = this._streams?.length ?? 1;
        return this._streams[length - 1] ?? null;
    };

    /**
     * Признак того, что в данный момент есть пред загружаемый поток,
     * ожидающий готовности (события `readable`).
     */
    public get preloaded(): boolean {
        if (!this._streams?.length) return false;
        return this._streams?.length > 1;
    };

    /**
     * Добавление нового ресурса.
     *
     * Каждый ресурс живёт в массиве пока:
     * - не станет активным
     * - старый не будет уничтожен
     */
    public set preload(stream: T) {
        // Если уже есть пред-загруженное аудио
        if (this._streams.length > 1) {
            const old = this._streams.shift();
            old?.destroy();
        }

        this._streams.push(stream);

        // Отслеживаем аудио поток на готовность к чтению
        stream.once("readable", () => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            const index = this._streams.indexOf(stream);

            // Если есть активный поток
            if (index === -1) return;
            if (index > 0) {
                const old = this._streams.shift();
                old?.destroy();
            }
        });

        // Отслеживаем аудио поток на ошибки
        stream.once("error", () => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            const index = this._streams.indexOf(stream);
            if (index !== -1) {
                this._streams.splice(index, 1);
            }

            // Уничтожаем новый аудио поток
            stream.destroy();
        });

        // Установка таймера ожидания
        this._timeout = setTimeout(() => {
            stream.emit("error", Error("Timeout: the stream has been exceeded!"));
        }, TRACK_CHECK_WAIT);
    };

    /**
     * Полное освобождение ресурсов: уничтожает текущий и пред загружаемый потоки,
     * сбрасывает все внутренние состояния и таймеры.
     *
     * После вызова экземпляр можно использовать повторно, но все ссылки на потоки
     * будут утеряны.
     */
    public destroy = () => {
        for (let stream of this._streams) {
            try {
                stream.destroy();
                stream = null;
            } catch {}
        }

        this._streams.length = 0;
        this._streams = [];

        clearTimeout(this._timeout);
        this._timeout = null;
    };

    /**
     * Пересчитывает кэшированную строку индикатора громкости на основе `_volume`.
     *
     * Использует разные эмодзи в зависимости от уровня:
     * - 10..29 → 🔈 (очень тихо)
     * - 30..69 → 🔉 (умеренно)
     * - 70..149 → 🔊 (громко)
     * - 150..200 → 📢 (максимальная громкость / усиление)
     *
     * Результат сохраняется в `_volumeIndicator` для мгновенного доступа.
     */
    private _updateVolumeIndicator(): void {
        const v = this._volume;
        if (v < 30) {
            this._volumeIndicator = `🔈 ${v}%`;
        } else if (v < 70) {
            this._volumeIndicator = `🔉 ${v}%`;
        } else if (v < 150) {
            this._volumeIndicator = `🔊 ${v}%`;
        } else {
            this._volumeIndicator = `📢 ${v}%`;
        }
    };
}