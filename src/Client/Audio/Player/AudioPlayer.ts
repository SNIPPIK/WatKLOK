import {AudioResource, Filter} from "@Client/Audio/Player/AudioResource";
import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";
import {Song} from "@Client/Audio/Queue/Song";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter<AudioPlayerEvents>
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly _db = {
        filters: []     as Filter[],
        status: "wait"  as AudioPlayerStatus,
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
        if (this.status === "wait" || !this.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.stream?.readable) {
            this.stream?.stream?.emit("end");
            this.status = "wait";
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
        if (status !== this._db.status) this.emit(status);
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
        this.status = "playing";
    };

    /**
     * @description Передача пакетов в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet);
        } catch (err) { //Если возникает ошибка, то выключаем плеер
            this.emit("error", err, true);
        }
    };

    /**
     * @description Начинаем чтение стрима
     * @public
     */
    private set read(stream: AudioResource) {
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => this.emit("error", "Timeout stream!", false), (env.get("player.streamTimeout") as number) * 1e3);
        stream.stream.once("readable", () => { //Включаем поток когда можно будет начать читать
            this.stream = stream;
            clearTimeout(timeout);
        }).once("error", () => { //Если происходит ошибка, то продолжаем читать этот же поток
            this.emit("error", "Fail read stream", false);
            clearTimeout(timeout);
        });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание
     * @param track {Song} Трек который будет включен
     * @param seek {number} Пропуск времени
     * @public
     */
    public play = async (track: Song, seek: number = 0) => {
        const path = await track.resource;

        if (path instanceof Error) {
            this.emit("error", `${path}`);
            return;
        }

        this.emit("onStart", seek);
        this.read = new AudioResource({path, filters: !track.options.isLive ? this.filters : [], seek});
    };

    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = (): void => {
        if (this.status !== "playing") return;
        this.connection.configureNetworking();
        this.status = "pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = (): void => {
        if (this.status !== "pause") return;
        this.connection.configureNetworking();
        this.status = "playing";
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @public
     */
    public stop = (): void => {
        if (this.status === "wait") return;
        this.status = "wait";
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

/**
 *  _____           _                    __
 * |_   _|         | |                  / _|
 *   | |    _ __   | |_    ___   _ __  | |_    __ _   ___    ___   ___
 *   | |   | '_ \  | __|  / _ \ | '__| |  _|  / _` | / __|  / _ \ / __|
 *  _| |_  | | | | | |_  |  __/ | |    | |   | (_| | \__ \ |  __/ \__ \
 * |_____| |_| |_|  \__|  \___| |_|    |_|    \__,_| |___/  \___| |___/
 */

/**
 * @author SNIPPIK
 * @description Статусы плеера
 * @type AudioPlayerStatus
 */
type AudioPlayerStatus = "wait" | "pause" | "playing" | "error";

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
interface AudioPlayerEvents {
    wait: () => void;
    pause: () => void;
    playing: () => void;
    error: (err: string, critical?: boolean) => void;

    onStart: (seek: number) => void;
}
