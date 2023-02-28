import {FFmpeg, getFilter, Arguments} from "@FFspace";
import {Music, Debug} from "@db/Config.json";
import {consoleTime} from "@Client/Client";
import {opus} from "prism-media";
import {Readable} from "stream";
import fs from "fs";

export {OpusAudio};
//====================== ====================== ====================== ======================


type AudioFilters = Array<string> | Array<string | number>;
type FFmpegOptions = {seek?: number, filters?: AudioFilters};

class OpusAudio {
    private _opus: opus.OggDemuxer = new opus.OggDemuxer({autoDestroy: true});
    private _streams: Array<Readable> = [];
    private _ffmpeg: FFmpeg;

    private _duration: number = 0;
    private _readable: boolean = false;
    private _durFrame: number = 20;

    //====================== ====================== ====================== ======================
    /**
     * @description Время проигрывания в секундах
     * @type {number}
     */
    public get duration() { return parseInt((this._duration / 1e3).toFixed(0)); };
    //====================== ====================== ====================== ======================
    /**
     * @description Возможно ли прочитать поток
     * @type {boolean}
     */
    // @ts-ignore
    public get readable(): boolean { return this._readable; };
    public get destroyed() { return this._opus?.destroyed ?? true; };
    //====================== ====================== ====================== ======================
    /**
     * @description Выдаем или добавляем ffmpeg из this.streams
     * @type {FFspace.FFmpeg}
     * @private
     */
    private get ffmpeg() { return this._ffmpeg as FFmpeg; };
    private set ffmpeg(ffmpeg: FFmpeg) { this._ffmpeg = ffmpeg; };
    //====================== ====================== ====================== ======================
    /**
     * @description opus.OggDemuxer
     */
    public get opus() { return this._opus };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем поток при помощи ffmpeg конвертируем любой файл в opus
     * @param path {string} Ссылка или путь до файла. Условие чтоб в конце пути был .opus
     * @param options {FFmpegOptions} Настройки FFmpeg, такие, как seek, filter
     */
    public constructor(path: string, options: FFmpegOptions) {
        const resource = path.endsWith("opus") ? fs.createReadStream(path) : path

        //Создаем ffmpeg
        this.ffmpeg = new FFmpeg(choiceArgs(path, typeof resource, options));

        //Если resource является Readable то загружаем его в ffmpeg
        if (resource instanceof Readable) {
            resource.pipe(this.ffmpeg);
            this._streams.push(resource);
        }
        this.ffmpeg.pipe(this.opus); //Загружаем из FFmpeg'a в opus.OggDemuxer

        //Проверяем сколько времени длится пакет
        if (options?.filters?.length > 0) this._durFrame = getDurationFilters(options?.filters);
        if (options.seek > 0) this._duration = options.seek * 1e3;

        //Когда можно будет читать поток записываем его в <this.#started>
        this.opus.once("readable", () => (this._readable = true));
        //Если в <this> будет один из этих статусов, чистим память!
        ["end", "close", "error"].forEach((event: string) => this.opus.once(event, this.destroy));

        if (Debug) consoleTime(`[Debug] -> OpusAudio: [Start decoding file in ${path}]`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Чтение пакета
     */
    public read = (): Buffer | null => {
        const packet: Buffer = this.opus?.read();

        if (packet) this._duration += this._durFrame;

        return packet;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем неиспользованные объекты
     */
    public destroy = (): void => {
        delete this._duration;
        delete this._readable;
        delete this._durFrame;

        if (this._streams?.length > 0) {
            for (const stream of this._streams) {
                if (stream !== undefined && !stream.destroyed) {
                    stream.removeAllListeners();
                    stream.destroy();
                    stream.read(); //Устраняем утечку памяти
                }
            }
        }
        delete this._streams;

        if (this.ffmpeg.deletable) {
            this.ffmpeg.removeAllListeners();
            this.ffmpeg.destroy();
            this.ffmpeg.read(); //Устраняем утечку памяти
        }
        delete this._ffmpeg;

        if (this.opus) {
            this.opus.removeAllListeners();
            this.opus.destroy();
            this.opus.read(); //Устраняем утечку памяти
        }
        delete this._opus;

        if (Debug) consoleTime(`[Debug] -> OpusAudio: [Clear memory]`);
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем аргументы в зависимости от типа resource
 * @param url {string} Ссылка
 * @param resource {string | Readable} Путь или поток
 * @param options {FFmpegOptions} Модификаторы для ffmpeg
 */
function choiceArgs(url: string, resource: string | Readable, options: FFmpegOptions): Arguments {
    if (resource === "string") return createArgs(url, options?.filters, options?.seek);
    return createArgs(null, options?.filters, options?.seek);
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем аргументы для FFmpeg
 * @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
 * @param url {string} Ссылка
 * @param seek {number} Пропуск музыки до 00:00:00
 */
function createArgs(url: string, AudioFilters: AudioFilters, seek: number): Arguments {
    const thisArgs = ["-reconnect", 1, "-reconnect_streamed", 1, "-reconnect_delay_max", 5];
    const audioDecoding = ["-c:a", "libopus", "-f", "opus"];
    const audioBitrate = ["-b:a", Music.Audio.bitrate];
    const filters = getFilters(AudioFilters, seek);

    if (seek) thisArgs.push("-ss", seek ?? 0);
    if (url) thisArgs.push( "-i", url);

    if (filters.length > 0) thisArgs.push("-af", filters);

    //Всегда есть один фильтр <AudioFade>
    return [...thisArgs, "-compression_level", 12,
        ...audioDecoding, ...audioBitrate, "-preset:a", "ultrafast"
    ];
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем множитель времени для правильного отображения. При добавлении новых аргументов в Filters.json<FilterConfigurator>, их нужно тоже добавить сюда!
 * @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
 */
function getDurationFilters(AudioFilters: AudioFilters): number {
    let duration = 20;

    if (AudioFilters) parseFilters(AudioFilters, (fl, filter) => {

        //Если у фильтра есть модификатор скорости
        if (filter?.speed) {
            if (typeof filter.speed === "number") duration *= Number(filter.speed);
            else {
                const Index = AudioFilters.indexOf(fl) + 1; //Позиция <filter> в AudioFilters
                const number = AudioFilters.slice(Index); //Получаем то что указал пользователь

                duration *= Number(number);
            }
        }
    });

    return duration;
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем фильтры для FFmpeg
 * @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
 * @param seek {number} Нужен для определения впервые включен ли поток
 */
function getFilters(AudioFilters: AudioFilters, seek: number): string {
    const response: Array<string> = [];

    //Включать более плавное включение музыки
    if (seek === 0) response.push("afade=t=in:st=0:d=3");
    response.push(`volume=${Music.Audio.volume / 100}`);

    if (AudioFilters) parseFilters(AudioFilters, (fl, filter) => {
        if (filter) {
            if (!filter.args) return response.push(filter.filter);

            const indexFilter = AudioFilters.indexOf(fl);
            response.push(`${filter.filter}${AudioFilters.slice(indexFilter + 1)[0]}`);
        }
    });

    return response.join(",");
}
//====================== ====================== ====================== ======================
/**
* @description Создаем фильтры для FFmpeg
* @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
* @param callback {Function}
*/
function parseFilters(AudioFilters: AudioFilters, callback: (fl: string, filter: any ) => void): void {
    AudioFilters.forEach((filter: string | number) => {
        if (typeof filter === "number") return;

        const Filter = getFilter(filter);

        return callback(filter, Filter);
    });
}