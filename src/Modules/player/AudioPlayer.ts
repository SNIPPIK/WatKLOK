import {AudioPlayerEvents, AudioPlayerStatus} from "@watklok/player/collection";
import {AudioResource, Filter} from "./AudioResource";
import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter<AudioPlayerEvents>
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly _local = {
        filters: []     as Filter[],
        status: "player/wait"  as AudioPlayerStatus,
        voice: null     as VoiceConnection,
        stream: null    as AudioResource
    };
    /**
     * @description Выдаем базу с фильтрами
     * @return Filter[]
     * @public
     */
    public get filters() { return this._local.filters; };

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
            if (this._local.voice.joinConfig.channelId === connection.joinConfig.channelId) return
        }

        this._local.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status {AudioPlayerStatus} Статус плеера
     * @private
     */
    public set status(status: AudioPlayerStatus) {
        if (status !== this._local.status) this.emit(status, this);
        this._local.status = status;
    };

    /**
     * @description Смена потока
     * @param stream {AudioResource} Opus конвертор
     * @private
     */
    public set stream(stream: AudioResource) {
        if (this.stream && this.stream !== stream) {
            try {
                this.stream?.stream?.emit("close");
            } catch {}

            //Удаляем прошлый поток
            this._local.stream = null;
        }


        //Продолжаем воспроизведение
        this._local.stream = stream;
        this.status = "player/playing";
    };

    /**
     * @description Передача пакетов в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet);
        } catch (err) { //Если возникает ошибка, то выключаем плеер
            this.emit("player/error", this, err, true);
        }
    };

    /**
     * @description Начинаем чтение стрима
     * @public
     */
    public set read(stream: AudioResource) {
        if (!stream.readable) {
            //Если не удается включить поток за 20 сек, выдаем ошибку
            const timeout = setTimeout(() => this.emit("player/error", this, "Timeout stream!", false), 20e3);

            stream.stream
                //Включаем поток когда можно будет начать читать
                .once("readable", () => {
                    this.stream = stream;
                    clearTimeout(timeout);
                })
                //Если происходит ошибка, то продолжаем читать этот же поток
                .once("error", () => {
                    this.emit("player/error", this, "Fail read stream", false);
                    clearTimeout(timeout);
                });
            return;
        }

        this.stream = stream;
    };



    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = (): void => {
        if (this.status !== "player/playing") return;
        this.connection.configureNetworking();
        this.status = "player/pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = (): void => {
        if (this.status !== "player/pause") return;
        this.connection.configureNetworking();
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
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop();

        try {
            this.stream?.stream?.emit("close");
        } catch {}

        for (let str of Object.keys(this._local)) this._local[str] = null;;
    };
}