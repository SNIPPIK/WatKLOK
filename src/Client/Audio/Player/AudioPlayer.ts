import {AudioResource, Filter} from "@Client/Audio/Player/AudioResource";
import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";
import {Song} from "@Client/Audio/Queue/Song";
/**
 * @author SNIPPIK
 * @description Статусы плеера
 */
type AudioPlayerStatus = "wait" | "pause" | "playing" | "error";

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 */
interface AudioPlayerEvents {
    wait: () => void;
    pause: () => void;
    playing: () => void;
    error: (err: string, critical?: boolean) => void;

    onStart: (seek: number) => void;
}


/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class Player
 */
class Player extends TypedEmitter<AudioPlayerEvents> {
    private readonly _filters: Filter[] = [];
    private _status: AudioPlayerStatus = "wait";
    private _connection: VoiceConnection;
    private _stream: AudioResource;
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
     * @description Позволяет добавлять или удалять фильтры
     * @return Filter[]
     * @public
     */
    public get filters() { return this._filters; };

    /**
     * @description Проверяем можно ли читать плеер
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
    public set connection(connection: VoiceConnection) { this._connection = connection; };
    public get connection() { return this._connection; };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status {AudioPlayerStatus} Статус плеера
     * @private
     */
    protected set status(status: AudioPlayerStatus) {
        if (status !== this._status) this.emit(status);
        this._status = status;
    };
    public get status() { return this._status; };

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
            this._stream = null;
        }


        //Продолжаем воспроизведение
        this._stream = stream;
        this.status = "playing";
    };
    public get stream() { return this._stream; };

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
    protected readStream = (stream: AudioResource): void => {
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
    }

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop();

        this._status = null;
        this._stream = null;
        this._connection = null;
    };
}


/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 */
export class AudioPlayer extends Player {
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
            this.readStream(new AudioResource({path, filters: !track.options.isLive ? this.filters : [], seek}));
        }).catch((err) => {
            this.emit("error", err);
        });
    };
}