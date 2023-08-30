import {FFmpegFilters, Filters} from "../FFspace/Filters";
import {FFmpeg} from "../FFspace/FFmpeg";
import { opus } from "prism-media";
import {Logger} from "@Logger";
import {env} from "@env";

export class OpusAudio {
    private _opus: opus.OggDemuxer = new opus.OggDemuxer({ autoDestroy: true, objectMode: true });
    private _durationFrame: number = parseInt(env.get("music.player.duration"));
    private _ffmpeg: FFmpeg   = null;
    private _duration: number = 0;
    private _read: boolean    = false;
    public constructor(options: {path: string, filters: Filters, seek: number}) {
        this._ffmpeg = new FFmpeg(options);
        this._ffmpeg.pipe(this.opus);

        //Отслеживаем ивенты OggDemuxer'а
        ["end", "close", "error"].forEach((event) => this.opus.once(event, () => {
            this.cleanup();

            if (env.get("debug.ffmpeg")) Logger.debug(`AudioPlayer: FFmpeg emit event ${event}`);
            if (env.get("debug.player.audio")) Logger.debug(`AudioPlayer: OpusCompilation: emit event ${event}`);
        }));

        const durationFrame = FFmpegFilters.getDuration(options?.filters);

        if (options.seek > 0) this._duration = options.seek * 1e3;
        if (durationFrame > 0) this._durationFrame = durationFrame;

        //Когда можно будет читать поток записываем его в <this._read>
        this.opus.once("readable", () => (this._read = true));
    };


    /**
     * @description Получаем время в секундах
     */
    public get duration(): number { return parseInt((this._duration / 1e3).toFixed(0)); };


    /**
     * @description Уничтожен ли поток
     */
    public get destroyed() { return this._opus?.destroyed; };


    /**
     * @description Можно ли читать поток
     */
    public get readable() { return this._read; };


    /**
     * @description Получаем конвертер в opus из Ogg/opus
     */
    public get opus() { return this._opus; };


    /**
     * @description Получаем пакет в размере this._durationFrame
     */
    public get read(): Buffer {
        const packet: Buffer = this._opus?.read();

        //Если пакет не пустой добавляем время к проигрыванию
        if (packet) this._duration += this._durationFrame;

        return packet;
    };


    /**
     * @description Удаляем данные из класса
     */
    public cleanup = () => {
        this._durationFrame = null;
        this._duration = null;
        this._read = null;

        //Удаляем поток
        if (!this.destroyed) {
            this._opus.removeAllListeners();
            this._opus.destroy();
        }
        this._opus = null;

        this._ffmpeg.destroy();
        this._ffmpeg = null;
    };
}