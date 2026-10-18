import { type AudioFilter, ControllerFilters, AudioPlayerEvents } from "#core/player/index.js";
import { ControllerTracks, ControllerVoice, RepeatType, Track } from "#core/queue/index.js";
import { AudioResource, SILENT_FRAMES } from "#core/audio/index.js";
import { PlayerProgress } from "../controllers/progress.js";
import type { VoiceConnection } from "#core/voice/index.js";
import { PlayerAudio } from "../structures/audio.js";
import { Logger, TypedEmitter } from "#structures";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Глобальный экземпляр для вычисления прогресс-бара.
 * @remarks
 * Вынесен для переиспользования, чтобы не создавать объект при каждом запросе.
 * @private
 */
const Progress = new PlayerProgress();

/**
 * @author SNIPPIK
 * @description Безопасное время (мс) между отправкой аудио пакетов при возобновлении после паузы.
 * @remarks
 * Используется для защиты от переполнения jitter-буфера. При паузе плеер продолжает отправлять
 * SILENT_FRAMES, но фактическое воспроизведение останавливается. Возобновление происходит только
 * после истечения этого интервала, чтобы избежать резкого наплыва пакетов.
 * @const
 * @private
 */
const PLAYER_PAUSE_OFFSET = 5e3;

/**
 * @author SNIPPIK
 * @description Безопасное время (мс) между завершением одного трека и началом следующего.
 * @remarks
 * Необходимо для корректного закрытия текущего аудиопотока и освобождения ресурсов перед
 * запуском следующего. Без этого VoiceSocket может получить переполнение буфера (пинг >1000).
 * @const
 * @private
 */
const PLAYER_TIMEOUT_OFFSET = 3e3;

/**
 * @author SNIPPIK
 * @description Основной класс аудио плеера, управляющий воспроизведением очереди треков.
 * @extends TypedEmitter<AudioPlayerEvents>
 * @public
 *
 * # Особенности
 * - Предотвращает загрузку нового трека, пока предыдущий не завершён (через 10 сек можно загрузить новый).
 * - Поддерживает «горячую» замену треков (hot swap) без сбоев jitter buffer (использует AudioPlayerTimeout).
 * - Умеет накладывать аудио фильтры через FFmpeg (громкость, эквалайзер и т.д.).
 * - Высокая надёжность, практически невозможно сломать благодаря встроенным тайм-аутам и защитным механизмам.
 *
 * @example
 * ```ts
 * const player = new AudioPlayer(tracks, voice, guildId);
 * player.on('player/playing', () => console.log('Now playing'));
 * player.play();
 * ```
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private _destroyed = false;

    /** Текущее состояние плеера (idle, playing, paused и т.д.) */
    protected _status: AudioPlayerState | null = AudioPlayerState.idle;

    /** Менеджер тайм-аутов для безопасной паузы/возобновления */
    protected _timer: AudioPlayerTimeout | null = new AudioPlayerTimeout();

    /** Хранилище активных аудио фильтров (громкость, эквалайзер и т.п.) */
    protected _filters: ControllerFilters<AudioFilter> | null = new ControllerFilters<AudioFilter>();

    /** Управление текущим аудиопотоком (чтение, буферизация, пред загрузка) */
    protected _audio: PlayerAudio<AudioResource> | null = new PlayerAudio();

    /** Защита от одновременного вызова play() */
    private _playLock: boolean = false;

    /**
     * @description Делаем tracks параметр публичным для использования вне класса
     * @public
     */
    public get tracks() {
        return this._tracks;
    };

    /**
     * @description Делаем filters параметр публичным для использования вне класса
     * @public
     */
    public get filters() {
        return this._filters;
    };

    /**
     * @description Делаем voice параметр публичным для использования вне класса
     * @public
     */
    public get voice() {
        return this._voice;
    };

    /**
     * @description Делаем stream параметр публичным для использования вне класса
     * @public
     */
    public get audio() {
        return this._audio;
    };

    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() {
        return this._status;
    };
    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @public
     */
    public set status(status: AudioPlayerState) {
        // Две отсечки:
        // - _destroyed: плеер уже уничтожен, трогать его состояние нельзя
        //   (все поля обнулены, emit может улететь в никуда);
        // - status === _status: no-op без побочных эффектов — иначе
        //   повторный set того же значения запускал бы _PlayerNextTrack.
        if (this._destroyed || status === this._status) return;

        // Прямая запись поля ДО emit'а: обработчики, которые в ответ
        // на событие полезут читать this._status, должны видеть уже
        // новое значение, а не старое.
        this._status = status;

        // Событие называется по имени нового статуса (динамически:
        // AudioPlayerState.idle / playing / paused / ...). Второй
        // аргумент — сам плеер, чтобы слушатель знал источник.
        this.emit(status, this);

        // Переход к следующему треку нужен только для штатного
        // завершения воспроизведения, а не для уничтожения плеера.
        // Т.е. если трек закончился сам (idle) — запускаем следующий.
        // При destroy/stop статус меняется в обход сеттера,
        // поэтому автозапуск не сработает (см. комментарии в stop/cleanup).
        if (status === AudioPlayerState.idle) {
            // Void — намеренно "отвязываем" обещание: сеттер синхронный,
            // ждать _PlayerNextTrack тут нельзя, иначе setter вернёт
            // Promise и сломает контракт.
            // .catch — не пробрасываем ошибку дальше (иначе unhandled
            // rejection), а превращаем её в событие "player/error".
            // Внутри catch снова проверяем _destroyed: пока обещание
            // летел, плеер мог быть уничтожен, и emit в мёртвый объект
            // не нужен.
            void this._PlayerNextTrack().catch(error => {
                if (!this._destroyed) {
                    this.emit("player/error", this, error);
                }
            });
        }
    };

    /**
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const { api, time } = this._tracks.track;
        const current = (this._audio.current?.duration || 0);

        // Создаем прогресс бар
        const bar =  Progress.bar({
                platform: api.name,
                duration: {
                    current: current,
                    total: time.total
                }
            }
        );

        // Собираем красивую строчку для EMBED
        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Наличие аудио-ресурса и статуса
        return this._status === "player/playing" && !!this._audio.current;
    };

    /**
     * @description Включение/Отключение плеера в цикла
     * @public
     */
    public set cycle(isActive: boolean) {
        if (!this.id) return;

        // Подключаем плеер к циклу
        if (isActive) {
            // Если нет плеера в цикле
            if (!db.queues.cycles.players.has(this)) {
                // Отправляем пустышку если такая возможность есть
                if (this._voice.connection.ready && !this.playing) this._voice.connection.packet(SILENT_FRAMES);

                // Добавляем плеер в цикл
                db.queues.cycles.players.add(this);
                this.emit("player/log", `[AudioPlayer/${this.id}] pushed in cycle`);
            }
        }

        // Отключаем плеер от цикла
        else if (!isActive) {
            // Если есть плеер в цикле
            if (db.queues.cycles.players.has(this)) {
                // Удаляем плеер из цикла
                db.queues.cycles.players.delete(this);

                // Отправляем пустышку если такая возможность есть
                if (this._voice.connection.ready && !this.playing) this._voice.connection.packet(SILENT_FRAMES);
                this.emit("player/log", `[AudioPlayer/${this.id}] removed from cycle`);
            }
        }
    };

    /**
     * @description В цикле сейчас плеер
     * @return boolean
     * @public
     */
    public get cycle() {
        return db.queues.cycles.players.has(this);
    };

    /**
     * @description Задаем параметры плеера перед началом работы
     * @param _tracks - Ссылка на треки из очереди
     * @param _voice - Ссылка на класс голосового подключения
     * @param id - ID сервера для аутентификации плеера
     * @constructor
     * @public
     */
    public constructor(
        /** Ссылка на класс с треками */
        protected _tracks: ControllerTracks<Track>,

        /** Ссылка на класс с голосовым подключением */
        protected _voice: ControllerVoice<VoiceConnection>,

        /** Уникальный id плеера */
        public id: string,
    ) {
        super();

        // Используем arrow function чтобы не потерять контекст и обработать ошибку
        setImmediate(() => this.play(0, 0).catch(err => this.emit("player/error", this, err, { skip: true, position: this._tracks.position })));

        /**
         * @description Событие получения ошибки плеера
         * @private
         */
        this.on("player/error", (player, error, skip) => {
            const queue = db.queues.get(player.id);
            const current = player.tracks.position;

            // Позиция трека для сообщения
            const position = skip?.position !== null ? skip?.position : current;

            // Выводим сообщение об ошибке
            queue.message.client.events.runCustom("message/error", queue, error, position);

            // Если надо пропустить трек
            if (skip.skip) {
                // Если надо пропустить текущую позицию
                if (skip.position === current) {
                    // Если плеер играет, то не пропускаем
                    if (player?.audio && player?.audio?.current?.packets > 0) return;
                    player.emit("player/wait", player);
                }

                // Если следующих треков нет
                if (player.tracks.size === 1 && !player.playing) queue.cleanup();
                player.tracks.remove(skip.position);
            }
        });

        /**
         * @description Выводим данные плеера
         * @private
         */
        this.on("player/log", (status) => {
            Logger.log("LOG", status);
        });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param timeout - Время через которое надо включить трек
     * @param position - Позиция нового трека
     * @public
     */
    public play = async (seek: number = 0, timeout: number = PLAYER_TIMEOUT_OFFSET, position: number = null): Promise<void> => {
        // Защита от одновременных вызовов
        if (this._playLock) return;
        this._playLock = true;

        try {
            let track: Track, index: number;

            // Если позиция явно указана
            if (typeof position === "number") {
                track = this._tracks.get(position);
                index = position;
            }

            // Если не указана позиция
            else {
                track = this._tracks.track;
                index = this._tracks.position;
            }

            // Если нет такого трека или статуса
            if (!track || this._status === null) return;

            // Сбрасываем предыдущий таймер, если он был
            this._timer.timer = null;

            try {
                // Получаем путь до аудио файла
                const resource = await track?.resource;

                // Если получена ошибка вместо исходника
                if (resource instanceof Error) {
                    this.emit("player/error", this, `${resource}`, { skip: true, position: index });
                    return;
                }

                // Если другой аудио поток загружается, то запрещаем включение
                if (this._audio.preloaded) return null;

                this.emit("player/log", `[AudioPlayer/${this.id}|${this._filters?.size}] has read ${!track.isLive ? "buffered" : "piped"} stream ${resource}`);

                // Выбираем тип аудио
                const stream = this._audio.preload = new AudioResource(
                    {
                        seek,
                        filters: this._filters.filters,
                        volume: this._audio.volume,
                        swapped: this._audio.current?.packets > 0,
                        track
                    }
                );

                // Подключаем события для отслеживания работы потока (временные)
                (stream as AudioResource)
                    // Если чтение возможно
                    .once("readable", () => {
                        // Время паузы плеера
                        const pauseTimeout = Math.max(this._timer.timeout - Date.now(), timeout, 0);

                        // Если включить трек сейчас не выйдет
                        if (pauseTimeout > 0) this._timer.timer = setTimeout(() => this._onPlayerReadable(index, seek), pauseTimeout);
                        else this._onPlayerReadable(index, seek);
                        return null;
                    })

                    // Если была получена ошибка при чтении
                    .once("error", (error: Error) => {
                        // Отправляем данные событию для отображения ошибки
                        this.emit("player/error", this, `${error}`, { skip: true, position: index });
                    })

                    // Если аудио поток был закрыт
                    .once("close", (status) => {
                        // Отправляем данные событию
                        this.emit("player/log", status);
                    });
            } catch (error) {
                this.emit("player/error", this, `${error}`, { skip: true, position: index });

                // Сообщаем об ошибке
                this.emit("player/log", `[Player/${this.id}] ${error}`);
            }
        } finally {
            this._playLock = false;
        }
    };

    /**
     * @description Приостанавливает воспроизведение плеера
     * @returns void
     * @public
     */
    public pause = (): void => {
        // Проверяем, что плеер действительно играет
        if (this._status !== "player/playing") return;

        // Переключаем статус на паузу
        this.status = AudioPlayerState.pause;

        // Устанавливаем время паузы
        this._timer.timeout = Date.now();

        // Отключаем плеер от цикла
        this.cycle = false;

        // Логируем
        this.emit("player/log", `[AudioPlayer/${this.id}] paused`);
    };

    /**
     * @description Возобновляет воспроизведение плеера
     * @returns void
     * @public
     */
    public resume = (): void => {
        if (this._status !== AudioPlayerState.pause) return;

        // Сколько осталось ждать до безопасного возобновления
        const remaining = this._timer.getRemaining();

        if (remaining === 0) {
            // Можно сразу возобновлять
            this.status = AudioPlayerState.playing;
            this._timer.timeout = 0; // очищаем
            this.cycle = true;

            this.emit("player/log", `[AudioPlayer/${this.id}] resumed immediately`);
            return;
        }

        // Иначе ставим таймер на оставшееся время
        this._timer.timer = setTimeout(() => {
            // Если плеер ещё в паузе
            if (this._status === AudioPlayerState.pause) {
                this.status = AudioPlayerState.playing;
                this._timer.timeout = 0;
                this.cycle = true;

                this.emit("player/log", `[AudioPlayer/${this.id}] resumed after delay`);
            }
        }, remaining);
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @returns Promise<void> | void
     * @public
     */
    public stop = (): void => {
        // Идемпотентность + защита от работы на уничтоженном плеере:
        // - _destroyed: плеер уже destroy()-нут, все ресурсы освобождены;
        // - idle: уже остановлен, повторный вызов не должен порождать
        //   лишних emit'ов и сбросов состояния.
        if (this._destroyed || this._status === AudioPlayerState.idle) {
            return;
        }

        // Отменяем запланированный запуск.
        // Таймер мог быть взведён на авто-старт следующего трека —
        // обнуляем только задачу, сам объект _timer жив.
        this._timer.timer = null;

        // Отключаем отправку аудио.
        // Если где-то в цикле стоит проверка cycle — после этого
        // кадры перестанут уходить в поток.
        this.cycle = false;

        // Уничтожаем активный и предварительно загруженный ресурс.
        // Опциональная цепочка: _audio может быть null до первого
        // play() или после предыдущего stop()/cleanup().
        this._audio?.destroy();

        // Намеренно не используем setter:
        // stop() не должен автоматически запускать следующий трек.
        // Прямая запись поля в обход сеттера — единственный способ
        // сменить статус без побочного эффекта "перейти к следующему".
        this._status = AudioPlayerState.idle;
        // Дублируем смену статуса событием — внешние слушатели подписаны
        // на конкретное значение (AudioPlayerState.idle), а не на "status changed".
        // Вторым аргументом передаём сам плеер, чтобы обработчик знал источник.
        this.emit(AudioPlayerState.idle, this);

        // Диагностический лог. Формат с id — чтобы различать события
        // разных инстансов плеера в общем логе.
        this.emit("player/log", `[AudioPlayer/${this.id}] stopped`);
    };

    /**
     * @description Включение следующего трека
     * @private
     */
    private readonly _PlayerNextTrack = async () => {
        const tracks = this.tracks;

        const repeat = tracks.repeat;
        const current = tracks.position;

        // Если включен повтор трека сменить позицию нельзя
        if (repeat === RepeatType.Song) tracks.position = current;

        // Если включен бесконечный поток
        else if (repeat === RepeatType.AutoPlay) {
            // Если последняя позиция
            if (current === tracks.total - 1) {
                try {
                    const related = await this._tracks.relatedTracks();

                    // Если получена ошибка
                    if (related instanceof Error) {
                        this.emit("player/log", related)
                        this.emit("player/error", this, related?.message);
                        return;
                    }

                } catch (err) {
                    this.emit("player/log", err as Error)
                }
            }

            // Меняем позицию трека в списке
            tracks.position = tracks.position + 1;
        }

        // Если включен повтор треков или его вовсе нет
        else {
            // Меняем позицию трека в списке
            tracks.position = tracks.position + 1;

            // Если повтор выключен
            if (repeat === RepeatType.None) {
                // Если очередь началась заново
                if (current + 1 === tracks.total && tracks.position === 0) {
                    return db.queues.get(this.id)?.cleanup();
                }
            }
        }

        // Через время запускаем трек, что-бы не нарушать работу VoiceSocket
        // Что будет если нарушить работу VoiceSocket, пинг >=1000
        this.play(0, PLAYER_TIMEOUT_OFFSET).catch((err) => this.emit("player/error", this, err));
        return;
    };

    /**
     * @param index - Номер нового трека
     * @param seek - Время перехода к позиции аудио трека
     * @returns void
     * @private
     */
    private readonly _onPlayerReadable = async (index: number, seek: number) => {
        // Если трек включен в 1 раз
        if (seek === 0) {
            const queue = db.queues.get(this.id);
            if (queue) queue.message.client.events.runCustom("message/playing", queue) // Отправляем сообщение, если можно
        }

        // Передаем плеер в цикл если его там нет!
        this.cycle = true;

        // Переводим плеер в состояние чтения аудио
        this.status = AudioPlayerState.playing;

        // Меняем позицию если удачно
        this._tracks.position = index;
    };

    /**
     * @description Эта функция частично удаляет плеер и некоторые сопутствующие данные
     * @returns void
     * @public
     */
    public cleanup = (): void => {
        // Идемпотентность: повторный cleanup/destroy после destroy —
        // no-op. Защищает от двойного освобождения ресурсов и лишних emit'ов.
        if (this._destroyed) return;

        // Обнуляем только поле timer, сам объект _timer оставляем —
        // cleanup не финализирует таймер, а лишь снимает текущую задачу.
        // Полный destroy() делает _timer.destroy() ниже.
        this._timer.timer = null;

        // Диагностический emit. Формат с id — чтобы в общем логе
        // различать события разных инстансов плеера.
        this.emit("player/log", `[AudioPlayer/${this.id}] has cleanup`);

        // Прямая запись не запускает _PlayerNextTrack().
        // Если бы статус менялся через публичный setter, тот бы триггернул
        // переход к следующему треку — а нам нужно просто "сбросить в idle"
        // без побочных эффектов автоматизации.
        this._status = AudioPlayerState.idle;

        // clear() очищает Set/Map in-place; обнулять саму ссылку не нужно —
        // _filters жив, просто пуст.
        if (this._filters && this._filters.size > 0) {
            this._filters.clear();
        }

        // Снимаем флаг цикла: следующий запуск не должен автоматически
        // повторять трек.
        this.cycle = false;

        // Опциональная цепочка: _audio мог уже быть null после
        // предыдущего destroy или до первой инициализации.
        this._audio?.destroy();

        // Выдерживаем защитный интервал перед следующим запуском.
        // Фиксируем момент cleanup в timestamp — по нему внешний код
        // (или следующая попытка старта) решает, сколько прошло времени.
        this._timer.timeout = Date.now();
    };


    /**
     * @description Эта функция полностью удаляет плеер и все сопутствующие данные
     * @returns void
     * @public
     */
    /**
     * @description Эта функция полностью удаляет плеер и все сопутствующие данные
     * @returns void
     * @public
     */
    public destroy = (): void => {
        // Если уже уничтожен — выходим сразу.
        // Проверка стоит ДО выставления флага, иначе второй вызов
        // снова прошёл бы весь путь освобождения.
        if (this._destroyed) return;

        // Флаг выставляем СРАЗУ — до emit'ов и разрушений.
        // Ниже emit может синхронно дёрнуть слушателя, а тот —
        // снова вызвать destroy(). Второй вызов должен увидеть
        // "уже уничтожен" и выйти, а не начать всё заново поверх
        // первого прохода.
        this._destroyed = true;

        this.emit("player/log", `[AudioPlayer/${this.id}] has destroyed`);

        // Сначала останавливаем таймер и аудио, потом обнуляем ссылки —
        // иначе потеряем доступ к объектам, которые надо прибрать.
        this._timer?.destroy();
        this._audio?.destroy();

        // Снимаем флаг цикла до обнуления id.
        // (Момент "до id = null" важен: emit выше ещё использует id.)
        this.cycle = false;

        // Родительский destroy: снимает слушателей EventEmitter'а,
        // чистит базовое состояние.
        super.destroy();

        // Обнуляем все ссылки, чтобы GC мог собрать связанные объекты
        // и чтобы последующие обращения падали явно (null),
        // а не тихо работали с полу-живым состоянием.
        this.id = null;
        this._audio = null;
        this._filters = null;
        this._status = null;
        this._timer = null;
    };
}


/**
 * @author SNIPPIK
 * @description Возможные состояния плеера.
 * @public
 */
export enum AudioPlayerState {
    /** Ожидание, нет активного трека */
    idle = "player/wait",

    /** Воспроизведение аудио */
    playing = "player/playing",

    /** Трек завершён (используется для автоматического переключения) */
    ended = "player/ended",

    /** Статус пауза плеера */
    pause = "player/pause",

    /** Статус ошибки плеера */
    error = "player/error",
}

/**
 * @author SNIPPIK
 * @description Управление безопасными паузами и таймингом плеера.
 * @remarks
 * Гарантирует, что после паузы или ошибки будет выдержана необходимая задержка перед возобновлением,
 * чтобы не нарушить работу jitter buffer и VoiceSocket.
 * @private
 */
class AudioPlayerTimeout {
    /** Время (мс), после которого разрешено возобновление (включает PLAYER_PAUSE_OFFSET) */
    protected _resumeAllowedAt: number = 0;

    /** Ссылка на активный таймер (для отмены) */
    private _resumeTimer: NodeJS.Timeout | null = null;

    /**
     * @description Возвращает время, когда будет разрешено возобновление, или 0.
     * @public
     */
    public get timeout(): number {
        return this._resumeAllowedAt;
    };

    /**
     * @description Устанавливает время разрешения возобновления с учётом PLAYER_PAUSE_OFFSET.
     * @param time - Базовое время (обычно момент паузы), если null – сброс в 0.
     * @public
     */
    public set timeout(time: number | null) {
        this._resumeAllowedAt = time !== null ? time + PLAYER_PAUSE_OFFSET : 0;
    };

    /**
     * @description Устанавливает или заменяет таймер возобновления.
     * @param timer - Таймер, может быть null (сбрасывает).
     * @public
     */
    public set timer(timer: NodeJS.Timeout | null) {
        if (this._resumeTimer) clearTimeout(this._resumeTimer);
        this._resumeTimer = timer;
    };

    /**
     * @description Возвращает оставшееся время до разрешения возобновления (в мс).
     * @returns 0, если возобновление разрешено сейчас.
     * @public
     */
    public getRemaining(): number {
        if (!this._resumeAllowedAt) return 0;
        return Math.max(this._resumeAllowedAt - Date.now(), 0);
    };

    /**
     * @description Очищает таймер и сбрасывает состояние.
     * @public
     */
    public destroy() {
        if (this._resumeTimer) {
            clearTimeout(this._resumeTimer);
            this._resumeTimer = null;
        }
        this._resumeAllowedAt = 0;
    };
}