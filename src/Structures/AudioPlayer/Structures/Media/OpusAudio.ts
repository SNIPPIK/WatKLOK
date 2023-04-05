import { AudioFilters, Filters } from "./AudioFilters";
import { Music, Debug } from "@db/Config.json";
import { FFmpeg, Arguments } from "./FFspace";
import { opus } from "prism-media";
import { Readable } from "stream";
import { Logger } from "@Logger";
import fs from "fs";

export class OpusAudio {
    /**
     * @description Кодировщик из Ogg в Opus
     */
    private _opus: opus.OggDemuxer = new opus.OggDemuxer({ autoDestroy: true, highWaterMark: 86 });
    //====================== ====================== ====================== ======================
    /**
     * @description Дополнительные потоки
     */
    private _streams: Readable[] = [];
    //====================== ====================== ====================== ======================
    /**
     * @description FFmpeg
     */
    private _ffmpeg: FFmpeg = null;
    //====================== ====================== ====================== ======================
    /**
     * @description Время игры потока
     */
    private _duration: number = 0;
    //====================== ====================== ====================== ======================
    /**
     * @description Возможно ли читать поток
     */
    private _readable: boolean = false;
    //====================== ====================== ====================== ======================
    /**
     * @description Время пакета
     */
    private _durFrame: number = 20;
    //====================== ====================== ====================== ======================
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем время в секундах
     */
    public get duration() { return parseInt((this._duration / 1e3).toFixed(0)); };
    //====================== ====================== ====================== ======================
    /**
     * @description Можно ли читать поток
     */
    public get readable() { return this._readable; };
    //====================== ====================== ====================== ======================
    /**
     * @description Уничтожен ли поток
     */
    public get destroyed() { return this._opus?.destroyed ?? true; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем декодировщик
     */
    public get opus() { return this._opus; };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем поток при помощи ffmpeg конвертируем любой файл в opus
     * @param path {string} Ссылка или путь до файла. Условие чтоб в конце пути был .opus
     * @param options {FFmpegOptions} Настройки FFmpeg, такие, как seek, filter
     */
    public constructor(path: string, options: FFmpegOptions) {
        const resource = path.endsWith("opus") ? fs.createReadStream(path) : path

        //Создаем ffmpeg
        this._ffmpeg = new FFmpeg((

            //Подготавливаем аргументы для FFmpeg
            () => {
                if (typeof resource === "string") return createArgs(path, options?.filters, options?.seek);
                return createArgs(null, options?.filters, options?.seek);
            }
        )(), { highWaterMark: 128 });

        //Если resource является Readable то загружаем его в FFmpeg
        if (resource instanceof Readable) {
            resource.pipe(this._ffmpeg);
            this._streams.push(resource);
        }
        this._ffmpeg.pipe(this.opus); //Загружаем из FFmpeg'a в opus.OggDemuxer

        //Проверяем сколько времени длится пакет
        if (options?.filters?.length > 0) this._durFrame = AudioFilters.getDuration(options?.filters);
        if (options.seek > 0) this._duration = options.seek * 1e3;

        //Если в <this> будет один из этих статусов, чистим память!
        ["end", "close", "error"].forEach((event: string) => {
            //Добавляем ивенты для декодера
            this.opus.once(event, this.destroy);

            //Добавляем ивенты для FFmpeg
            this._ffmpeg.once(event, this._ffmpeg.destroy);
        });

        //Когда можно будет читать поток записываем его в <this._readable>
        this.opus.once("readable", () => (this._readable = true));

        if (Debug) Logger.debug(`[AudioPlayer]: [OpusAudio]: Decoding [${path}]`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Выдаем пакет, добавляем время
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
        this._duration = null;
        this._readable = null;
        this._durFrame = null;

        //Удаляем потоки
        for (let stream of [this._ffmpeg, this.opus, ...this._streams]) {
            if (stream !== undefined && !stream.destroyed) {
                stream.removeAllListeners();
                stream.destroy();
                stream.read();
            }
        }
        this._ffmpeg = null;
        this._opus = null;
        this._streams = null;

        if (Debug) Logger.debug(`[AudioPlayer]: [OpusAudio]: Destroying!`);
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем аргументы для FFmpeg
 * @param Filters {Filters} Аудио фильтры которые включил пользователь
 * @param url {string} Ссылка
 * @param seek {number} Пропуск музыки до 00:00:00
 */
function createArgs(url: string, Filters: Filters, seek: number): Arguments {
    const reconnect = ["-reconnect", 1, "-reconnect_streamed", 1, "-reconnect_delay_max", 5];
    const Audio = ["-c:a", "libopus", "-f", "opus", "-b:a", Music.Audio.bitrate];
    const filters = AudioFilters.getVanilaFilters(Filters, seek);

    if (seek) reconnect.push("-ss", seek ?? 0);
    if (url) reconnect.push("-i", url);

    if (filters.length > 0) reconnect.push("-af", filters);

    //Всегда есть один фильтр <AudioFade>
    return [...reconnect, "-compression_level", 12, ...Audio, "-preset:a", "ultrafast"];
}
//====================== ====================== ====================== ======================
/**
 * @description Модификаторы для FFmpeg
 */
type FFmpegOptions = { seek?: number, filters?: Filters };