import {AudioFilters, Filters} from "../AudioFilters";
import {FFmpeg} from "../FFspace/FFmpeg";
import { opus } from "prism-media";
import {Logger} from "@Logger";
import {env} from "@env";

export class OpusAudio {
    private _ffmpeg: FFmpeg;
    private _opus: opus.OggDemuxer = new opus.OggDemuxer({ autoDestroy: true, objectMode: true });
    private _durationFrame: number = parseInt(env.get("music.player.duration"));
    private _duration: number = 0;
    private _read: boolean = false;

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
     * @description Получаем время в секундах
     */
    public get duration(): number {
        const duration = (this._duration / 1e3).toFixed(0);

        return parseInt(duration);
    };


    public constructor(options: {path: string, filters: Filters, seek: number}) {
        this._ffmpeg = new FFmpeg(options);
        this._ffmpeg.pipe(this.opus);

        //Если будет вызван один из этих ивентов, то чистим ffmpeg, opusDecoder
        ["end", "close", "error"].forEach((event) => this.opus.once(event, () => {
            this._ffmpeg.destroy();
            this.destroy();

            if (env.get("debug.ffmpeg")) Logger.debug(`AudioPlayer: FFmpeg emit event ${event}`);
            if (env.get("debug.player.audio")) Logger.debug(`AudioPlayer: OpusCompilation: emit event ${event}`);
        }));

        const durationFrame = AudioFilters.getDuration(options?.filters);

        if (options.seek > 0) this._duration = options.seek * 1e3;
        if (durationFrame > 0) this._durationFrame = durationFrame;

        //Когда можно будет читать поток записываем его в <this._read>
        this.opus.once("readable", () => (this._read = true));
    };

    public readonly destroy = () => {
        this._durationFrame = null;
        this._duration = null;
        this._read = null;

        //Удаляем поток
        if (!this.destroyed) {
            this._opus.removeAllListeners();
            this._opus.destroy();
        }

        this._ffmpeg = null;
        this._opus = null;
    };
}