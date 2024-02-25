import {AudioPlayerEvents} from "@watklok/player/collection";
import {VoiceConnection} from "@watklok/voice/VoiceConnection";
import {TypedEmitter} from "tiny-typed-emitter";
import {AudioResource} from "./AudioResource";
import {db} from "@Client/db";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends EventEmitter
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly _local = {
        status: "player/wait"   as keyof AudioPlayerEvents,
        filters: []             as Filter[],
        voice:  null            as VoiceConnection,
        stream: null            as AudioResource
    };
    /**
     * @description Выдаем базу с фильтрами
     * @return Filter[]
     * @public
     */
    public get filters() { return this._local.filters; };

    /**
     * @description Получаем фильтры для FFmpeg
     * @return object
     */
    public get parseFilters() {
        const realFilters = [`volume=${db.AudioOptions.volume / 100}`]; let chunkSize = 0;

        //Проверяем фильтры
        for (const filter of this.filters) {

            //Если фильтр не требует аргумента
            if (!filter.args) realFilters.push(filter.filter);
            else realFilters.push(filter.filter + filter.user_arg ?? "");

            //Если у фильтра есть модификатор скорости
            if (filter?.speed) {
                if (typeof filter.speed === "number") chunkSize += Number(filter.speed);
                else chunkSize += Number(this.filters.slice(this.filters.indexOf(filter) + 1));
            }
        }

        //Надо ли плавное включения треков
        realFilters.push(`afade=t=in:st=0:d=${db.AudioOptions.fade}`);

        return { filters: realFilters.join(","), chunkSize }
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this._local.voice; };

    /**
     * @description
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this._local.status; };

    /**
     * @description
     * @return AudioResource
     * @public
     */
    public get stream() { return this._local.stream; };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        if (this.status === "player/wait" || !this.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.stream?.readable) {
            this.stream?.stream?.emit("end");
            this.status = "player/wait";
            return false;
        }

        return true;
    };


    /**
     * @description Взаимодействие с голосовым подключением
     * @param connection {VoiceConnection} Голосовое подключение
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (this._local.voice) {
            if (this._local.voice.config.channelId === connection.config.channelId) return;
        }

        this._local.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status {keyof AudioPlayerEvents} Статус плеера
     * @private
     */
    public set status(status: keyof AudioPlayerEvents) {
        //Если новый статус не является старым
        if (status !== this._local.status) {
            if (status === "player/pause" || status === "player/wait") this.stream?.stream?.emit("pause");
            this.emit(status, this);
        }

        this._local.status = status;
    };

    /**
     * @description Смена потока
     * @param stream {AudioResource} Opus конвертор
     * @private
     */
    public set stream(stream: AudioResource) {
        //Если есть текущий поток
        if (this.stream && this.stream?.stream) {
            this.stream?.stream?.emit("close");
            this._local.stream = null;
        }

        //Подключаем новый поток
        this._local.stream = stream;
        this.status = "player/playing";
    };

    /**
     * @description Передача пакета в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet)
        } catch (err: any) {
            //Подключаемся к голосовому каналу заново
            if ((`${err}`).match(/getaddrinfo/)) {
                this.status = "player/pause";
                this.emit("player/error", this, `Attempt to reconnect to the voice channel!`);

                for (let r = 0; r === 2; r++) {
                    if (this.connection.state.status === "ready") break;

                    this.connection.rejoin();
                }

                //Если попытка подключится удалась
                if (this.connection.state.status === "ready") {
                    this.status = "player/playing";
                    return;
                } else {
                    this.emit("player/error", this, `The reconnection attempt failed!`, "crash");
                    return;
                }
            }

            //Если возникает не исправимая ошибка, то выключаем плеер
            this.emit("player/error", this, `${err}`, "crash");
        }
    };

    /**
     * @description Начинаем чтение стрима
     * @public
     */
    public set read(stream: AudioResource) {
        //Если стрим можно прочитать
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => {
            this.emit("player/error", this, "Timeout stream!", "skip");
        }, 25e3);

        stream.stream

            //Включаем поток когда можно будет начать читать
            .once("readable", () => {
                this.stream = stream;
                clearTimeout(timeout);
            })

            //Если происходит ошибка, то продолжаем читать этот же поток
            .once("error", () => {
                this.emit("player/error", this, "Fail read stream", "skip");
                clearTimeout(timeout);
            });

    };


    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = (): void => {
        if (this.status !== "player/playing") return;
        this.status = "player/pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = (): void => {
        if (this.status !== "player/pause") return;
        this.status = "player/playing";
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @public
     */
    public stop = (): void => {
        if (this.status === "player/wait") return;
        this.status = "player/wait";
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        try { this.stream?.stream?.emit("close"); } catch {}
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop();

        for (let str of Object.keys(this._local)) this._local[str] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface
 */
export interface Filter {
    //Имена
    names: string[];

    //Описание
    description: string;

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number];

    user_arg: any;

    //Меняется ли скорость
    speed?: null | number;
}