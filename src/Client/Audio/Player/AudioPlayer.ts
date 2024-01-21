import {AudioResource, Filter} from "@Client/Audio/Player/AudioResource";
import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";
import {Song} from "@Client/Audio/Queue/Song";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter<AudioPlayerEvents>
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly _array = {
        filters: [] as Filter[]
    };

    private readonly _global = {
        status: "wait" as AudioPlayerStatus,
        voice: null as VoiceConnection,
        stream: null as AudioResource
    };
    /**
     * @description Возможно ли сейчас пропустить трек
     * @return boolean
     * @public
     */
    public get hasSkipped() { return (["playing", "pause"] as AudioPlayerStatus[]).includes(this.status); };

    /**
     * @description Можно ли обновить сообщение
     * @return boolean
     * @public
     */
    public get hasUpdate() { return (["playing"] as AudioPlayerStatus[]).includes(this.status); };

    /**
     * @description Выдаем базу с фильтрами
     * @return Filter[]
     * @public
     */
    public get filters() { return this._array.filters; };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this._global.voice; };

    /**
     * @description
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this._global.status; };

    /**
     * @description
     * @return AudioResource
     * @public
     */
    public get stream() { return this._global.stream; };

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
        if (connection.joinConfig.channelId === connection.joinConfig.channelId) return;
        this._global.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status {AudioPlayerStatus} Статус плеера
     * @private
     */
    protected set status(status: AudioPlayerStatus) {
        if (status !== this._global.status) this.emit(status);
        this._global.status = status;
    };

    /**
     * @description Смена потока
     * @param stream {AudioResource} Opus конвертор
     * @private
     */
    protected set stream(stream: AudioResource) {
        if (this.stream && this.stream !== stream) {
            try {
                if (!this.stream?.stream?.destroyed) this.stream?.stream?.emit("close");
            } catch {}

            //Удаляем прошлый поток
            this._global.stream = null;
        }


        //Продолжаем воспроизведение
        this._global.stream = stream;
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
    private set readStream(stream: AudioResource) {
        if (!stream.readable) {
            //Если не удается включить поток за 20 сек, выдаем ошибку
            const timeout = setTimeout(() => this.emit("error", "Timeout stream!", false), 20e3);

            stream.stream
                //Включаем поток когда можно будет начать читать
                .once("readable", () => {
                    this.stream = stream;
                    clearTimeout(timeout);
                })
                //Если происходит ошибка, то продолжаем читать этот же поток
                .once("error", () => {
                    this.emit("error", "Fail read stream", false);
                    clearTimeout(timeout);
                });
            return;
        }

        this.stream = stream;
    };




    /**
     * @description Функция отвечает за циклическое проигрывание
     * @param track {Song} Трек который будет включен
     * @param seek {number} Пропуск времени
     * @public
     */
    public play = (track: Song, seek: number = 0): void => {
        track.resource.then((path) => {
            if (path instanceof Error) {
                this.emit("error", `${path}`);
                return
            }

            this.emit("onStart", seek);
            this.readStream = new AudioResource({path, filters: !track.options.isLive ? this.filters : [], seek});
        }).catch((err) => {
            this.emit("error", err);
        });
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

        for (let str of Object.keys(this._global))  this._global[str] = null;
        this._array.filters = null;
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
