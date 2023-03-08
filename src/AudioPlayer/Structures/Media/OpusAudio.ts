import {AudioFilters, Filters} from "@Media/AudioFilters";
import { FFmpeg, Arguments } from "@Media/FFspace";
import { Music, Debug } from "@db/Config.json";
import { opus } from "prism-media";
import { Readable } from "stream";
import { Logger } from "@Logger";
import fs from "fs";

export { OpusAudio };
//====================== ====================== ====================== ======================


type FFmpegOptions = { seek?: number, filters?: Filters };

class OpusAudio {
    private _opus: opus.OggDemuxer = new opus.OggDemuxer({ autoDestroy: true, highWaterMark: 24 });
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
        this.ffmpeg = new FFmpeg(choiceArgs(path, typeof resource, options), {highWaterMark: 16});

        //Если resource является Readable то загружаем его в ffmpeg
        if (resource instanceof Readable) {
            resource.pipe(this.ffmpeg);
            this._streams.push(resource);
        }
        this.ffmpeg.pipe(this.opus); //Загружаем из FFmpeg'a в opus.OggDemuxer

        //Проверяем сколько времени длится пакет
        if (options?.filters?.length > 0) this._durFrame = AudioFilters.getDuration(options?.filters);
        if (options.seek > 0) this._duration = options.seek * 1e3;

        //Когда можно будет читать поток записываем его в <this._readable>
        this.opus.once("readable", () => (this._readable = true));
        //Если в <this> будет один из этих статусов, чистим память!
        ["end", "close", "error"].forEach((event: string) => this.opus.once(event, this.destroy));

        if (Debug) Logger.debug(`[AudioPlayer]: [OpusAudio]: Decoding [${path}]`);
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
                    stream.read();
                }
            }
        }
        delete this._streams;

        if (this.ffmpeg.deletable) {
            this.ffmpeg.removeAllListeners();
            this.ffmpeg.destroy();
            this.ffmpeg.read();
        }
        delete this._ffmpeg;

        if (this.opus) {
            this.opus.removeAllListeners();
            this.opus.destroy();
            this.opus.read();
        }
        delete this._opus;

        if (Debug) Logger.debug(`[AudioPlayer]: [OpusAudio]: Cleaning memory!`);
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
 * @param Filters {Filters} Аудио фильтры которые включил пользователь
 * @param url {string} Ссылка
 * @param seek {number} Пропуск музыки до 00:00:00
 */
function createArgs(url: string, Filters: Filters, seek: number): Arguments {
    const thisArgs = ["-reconnect", 1, "-reconnect_streamed", 1, "-reconnect_delay_max", 5];
    const audioDecoding = ["-c:a", "libopus", "-f", "opus"];
    const audioBitrate = ["-b:a", Music.Audio.bitrate];
    const filters = AudioFilters.getVanilaFilters(Filters, seek);

    if (seek) thisArgs.push("-ss", seek ?? 0);
    if (url) thisArgs.push("-i", url);

    if (filters.length > 0) thisArgs.push("-af", filters);

    //Всегда есть один фильтр <AudioFade>
    return [...thisArgs, "-compression_level", 12,
    ...audioDecoding, ...audioBitrate, "-preset:a", "ultrafast"
    ];
}