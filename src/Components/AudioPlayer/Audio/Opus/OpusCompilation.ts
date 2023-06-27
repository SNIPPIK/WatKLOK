import { opus } from "prism-media";

//Client
import {env} from "@Client/Fs";

//Utils
import {Logger} from "@Utils/Logger";

export class OpusCompilation {
    private readonly _opus = new opus.OggDemuxer({ autoDestroy: true });
    private readonly _durationFrame = parseInt(env.get("music.player.duration"));
    private _duration = 0;
    private _read = false;

    /**
     * @description Уничтожен ли поток
     */
    public get destroyed() { return this._opus?.destroyed ?? true; };


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


    /**
     * @description Отслеживаем ивенты
     * @param events {string[]} Список ивентов
     */
    private set onceEvents(events: string[]) {
        events.forEach((event: string) => {
            //Добавляем ивенты для декодера
            this.opus.once(event, () => {
                this._duration = null;
                this._read = null;

                //Удаляем поток
                if (this._opus !== undefined && !this._opus.destroyed) {
                    this._opus.removeAllListeners();
                    this._opus.destroy();
                }

                if (env.get("debug.player.audio")) Logger.debug(`AudioPlayer: OpusCompilation: emit event ${event}`);
            });
        });

        //Когда можно будет читать поток записываем его в <this._read>
        this.opus.once("readable", () => (this._read = true));
    };


    public constructor(duration: number, durationFrame: number) {
        if (duration > 0) this._duration = duration * 1e3;
        if (durationFrame > 0) this._durationFrame = durationFrame;

        this.onceEvents = ["end", "close", "error"];
    };
}