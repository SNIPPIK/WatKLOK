import {AudioPlayerEvents, AudioPlayerStatus} from "@watklok/player/collection";
import {AudioResource, Filter} from "./AudioResource";
import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter<AudioPlayerEvents>
 * @public
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly _db = {
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
    public get filters() { return this._db.filters; };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this._db.voice; };

    /**
     * @description
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this._db.status; };

    /**
     * @description
     * @return AudioResource
     * @public
     */
    public get stream() { return this._db.stream; };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        if (this.status === "player/wait" || !this.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.stream?.readable) {
            this.stream?.stream?.emit("close");
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
        if (this._db.voice) {
            if (this._db.voice.joinConfig.channelId === connection.joinConfig.channelId) return;
        }

        this._db.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status {AudioPlayerStatus} Статус плеера
     * @private
     */
    protected set status(status: AudioPlayerStatus) {
        if (status !== this._db.status) this.emit(status, this);
        this._db.status = status;
    };

    /**
     * @description Смена потока
     * @param stream {AudioResource} Opus конвертор
     * @private
     */
    protected set stream(stream: AudioResource) {
        if (this._db.stream) this._db.stream.cleanup();

        this._db.stream = stream;
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
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => this.emit("player/error", this, "Timeout stream!", false), 20e3);
        stream.stream.once("readable", () => { //Включаем поток когда можно будет начать читать
            this.stream = stream;
            clearTimeout(timeout);
        }).once("error", () => { //Если происходит ошибка, то продолжаем читать этот же поток
            this.emit("player/error", this, "Fail read stream", false);
            clearTimeout(timeout);
        });
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

        for (let str of Object.keys(this._db)) this._db[str] = null;
    };
}