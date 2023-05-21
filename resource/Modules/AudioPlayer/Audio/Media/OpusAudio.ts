import { AudioFilters, Filters } from "../AudioFilters";
import { FFmpeg } from "./FFspace";
import { opus } from "prism-media";
import { Readable } from "stream";
import { Logger } from "@Logger";
import fs from "fs";
import {env} from "@env";

const debug = env.get("debug.player.audio");
const bitrate = env.get("music.audio.bitrate");

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
     * @description Получаем конвертер в opus из Ogg/opus
     */
    public get opus() { return this._opus; };
    //====================== ====================== ====================== ======================
    /**
     * @description Выдаем пакет, добавляем время
     */
    public read(): Buffer | null {
        const packet: Buffer = this.opus?.read();

        if (packet) this._duration += this._durFrame;

        return packet;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем аргументы для FFmpeg
     */
    private get args() {
        const reconnect = ["-vn", "-sn", "-dn", "-reconnect", 1, "-reconnect_streamed", 1, "-reconnect_delay_max", 5];
        const Audio = ["-compression_level", 12, "-c:a", "libopus", "-f", "opus", "-b:a", bitrate, "-preset:a", "ultrafast"];

        return (path: string, seek: number, filters: string) => {
            if (seek) reconnect.push("-ss", seek ?? 0);
            if (path) reconnect.push("-i", path);
            if (filters) reconnect.push("-af", filters);

            return [...reconnect, ...Audio];
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем FFmpeg, opus.OggDemuxer
     * @param options { seek?: number, filters?: Filters, path: string } Аргументы запуска
     */
    private set pushStreams(options: { seek?: number, filters?: Filters, path: string }) {
        const resource = options.path.endsWith("opus") ? fs.createReadStream(options.path) : options.path
        const filters = AudioFilters.getVanillaFilters(options?.filters, options?.seek);

        //Создаем ffmpeg
        this._ffmpeg = new FFmpeg(this.args(typeof resource === "string" ? options.path : null, options?.seek, filters), { highWaterMark: 128 });

        //Если resource является Readable то загружаем его в FFmpeg
        if (resource instanceof Readable) {
            resource.pipe(this._ffmpeg);
            this._streams.push(resource);
        }
        this._ffmpeg.pipe(this.opus); //Загружаем из FFmpeg'a в opus.OggDemuxer

        if (debug) Logger.debug(`[AudioPlayer]: [OpusAudio]:\n┌ Status:       [Encoding]\n├ Modification: [Filters: ${options?.filters?.length} | Seek: ${options?.seek}]\n└ File:         [${options.path}]`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем ивенты для отслеживания
     * @param events {string[]} Ивенты отслеживания
     */
    private set createEvents(events: string[]) {
        //Если в <this> будет один из этих статусов, чистим память!
        events.forEach((event: string) => {
            //Добавляем ивенты для декодера
            this.opus.once(event, this.destroy);

            //Добавляем ивенты для FFmpeg
            this._ffmpeg.once(event, this._ffmpeg.destroy);
        });

        //Когда можно будет читать поток записываем его в <this._readable>
        this.opus.once("readable", () => (this._readable = true));
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем поток при помощи ffmpeg конвертируем любой файл в opus
     * @param path {string} Ссылка или путь до файла. Условие чтоб в конце пути был .opus
     * @param options {seek?: number, filters?: Filters} Настройки FFmpeg, такие, как seek, filter
     */
    public constructor(path: string, options: { seek?: number, filters?: Filters }) {
        //Задаем старт
        this.pushStreams = {...options, path};

        //Проверяем сколько времени длится пакет
        if (options?.filters?.length > 0) this._durFrame = AudioFilters.getDuration(options?.filters);
        if (options.seek > 0) this._duration = options.seek * 1e3;

        this.createEvents = ["end", "close", "error"];
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

        if (debug) Logger.debug(`[AudioPlayer]: [OpusAudio]: Destroying!`);
    };
}