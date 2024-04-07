import {VoiceConnection} from "@lib/voice/VoiceConnection";
import {TypedEmitter} from "tiny-typed-emitter";
import {SeekStream} from "./audio";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly data = {
        status: "player/wait"   as keyof AudioPlayerEvents,
        filters: []             as Filter[],
        voice:  null            as VoiceConnection,
        stream: null            as SeekStream
    };
    /**
     * @description Выдаем базу с фильтрами
     * @return Filter[]
     * @public
     */
    public get filters() { return this.data.filters; };

    /**
     * @description Получаем фильтры для FFmpeg
     * @return object
     */
    public get filtersString() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`];
        let chunk = 0;

        for (const filter of this.filters) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            if (filter.speed) chunk += typeof filter.speed === "number" ? Number(filter.speed) : Number(this.filters.slice(this.filters.indexOf(filter) + 1));
        }

        realFilters.push(`afade=t=in:st=0:d=${db.audio.options.fade}`);

        return { filters: realFilters.join(","), chunk };
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this.data.voice; };

    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this.data.status; };

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get stream() { return this.data.stream; };

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
     * @param connection - Голосовое подключение
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (this.data.voice) {
            if (this.data.voice.config.channelId === connection.config.channelId) return;
        }

        this.data.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @private
     */
    public set status(status: keyof AudioPlayerEvents) {
        //Если новый статус не является старым
        if (status !== this.data.status) {
            if (status === "player/pause" || status === "player/wait") this.stream?.stream?.emit("pause");
            this.emit(status, this);
        }

        this.data.status = status;
    };

    /**
     * @description Смена потока
     * @param stream - Opus конвертор
     * @private
     */
    public set stream(stream: SeekStream) {
        //Если есть текущий поток
        if (this.stream && this.stream?.stream) {
            this.stream?.stream?.emit("close");
            this.data.stream = null;
        }

        //Подключаем новый поток
        this.data.stream = stream;
        this.status = "player/playing";
    };

    /**
     * @description Передача пакета в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet)
        } catch (err) {
            //Подключаемся к голосовому каналу заново
            if (`${err}`.includes("getaddrinfo")) {
                this.status = "player/pause";
                this.emit("player/error", this, `Attempt to reconnect to the voice channel!`);

                for (let r = 0; r < 2; r++) {
                    if (this.connection.state.status === "ready") break;
                    this.connection.rejoin();
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
    public set read(options: {path: string, seek: number}) {
        const stream = new SeekStream(Object.assign(options, this.filtersString));

        //Если стрим можно прочитать
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => {
            this.emit("player/error", this, "Timeout the stream has been exceeded!", "skip");
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

        for (let str of Object.keys(this.data)) this.data[str] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    //Плеер начал играть новый трек
    "player/ended": (player: AudioPlayer, seek: number) => void;

    //Плеер закончил играть трек
    "player/wait": (player: AudioPlayer) => void;

    //Плеер встал на паузу
    "player/pause": (player: AudioPlayer) => void;

    //Плеер играет
    "player/playing": (player: AudioPlayer) => void;

    //Плеер получил ошибку
    "player/error": (player: AudioPlayer, err: string, type?: "crash" | "skip") => void;
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface
 */
export interface Filter {
    //Имена
    name: string;

    //Имена несовместимых фильтров
    unsupported: string[];

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