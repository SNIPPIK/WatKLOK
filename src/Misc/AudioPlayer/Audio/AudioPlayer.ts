import {VoiceConnection} from "@discordjs/voice";
import {Cycles_Players} from "@Cycles/Players";
import {TypedEmitter} from "@Emitter";
import {OpusAudio} from "./Opus";
import {Logger} from "@Logger";
import {env} from "@env";

const CyclePlayers = new Cycles_Players();
const SkippedStatuses = ["read", "pause"];
const UpdateMessage = ["read"];
const Debug: boolean = env.get("debug.player");
const AudioType = env.get("music.audio.type");

export class AudioPlayer extends TypedEmitter<PlayerEvents> {
    private _status: PlayerStatus         = "idle";
    private _stream: OpusAudio            = null;
    private _connection: VoiceConnection  = null;

    /**
     * @description Общее время проигрывания музыки
     */
    public get duration() { return this.stream?.duration ?? 0 };


    /**
     * @description Действие будет высчитано из аргумента
     * @param data {PlayerStatus | OpusAudio} Статус или поток
     */
    public set state(data: PlayerStatus | OpusAudio) {
        if (Debug) Logger.debug(`AudioPlayer${typeof data === "string" ? `.status: [${this._status} to ${data}]` : `.stream has [${!!data}]`}`);

        if (typeof data !== "string") {
            //Если введен новый поток и есть старый, то закрываем старый
            if (this._stream && !this._stream.destroyed && this._stream !== data) {
                this.sendPacket = Buffer.from([0xf8, 0xff, 0xfe, 0xfae]);
                this._stream.opus?.emit("close");
            }

            //Если есть новый поток
            if (data) { this._stream = data; this.state = "read"; }

            return;
        }

        //Надо ли удалять плеер из базы
        if (data === "idle") CyclePlayers.remove = this;
        else CyclePlayers.push = this;

        //Если статусы не совпадают, то делаем emit
        if (this._status !== data) this.emit(data);
        this._status = data;
    };


    /**
     * @description Задаем голосовое подключение для отправления пакетов
     * @param connection {VoiceConnection} Голосовое подключение
     */
    public set connection(connection: VoiceConnection) {
        //Если колосовое подключение совпадает с текущим
        if (this._connection === connection) return;

        //Перезаписываем голосовое подключение
        this._connection = connection;
    };


    /**
     * @description Получаем голосовое подключение
     */
    public get connection() { return this._connection; };


    /**
     * @description Получаем текущий поток
     */
    public get stream() { return this._stream; };


    /**
     * @description Получаем текущий статус
     */
    public get status() { return this._status; };


    /**
     * @description Возможно ли сейчас пропустить трек
     */
    public get hasSkipped() { return SkippedStatuses.includes(this.status); };


    /**
     * @description Можно ли обновить сообщение
     */
    public get hasUpdate() { return UpdateMessage.includes(this.status); };


    /**
     * @description Ставим на паузу плеер
     */
    public get pause(): void {
        if (this.status !== "read") return;
        this.state = "pause";
    };


    /**
     * @description Убираем с паузы плеер
     */
    public get resume(): void {
        if (this.status !== "pause") return;
        this.state = "read";
    };


    /**
     * @description Останавливаем воспроизведение текущего трека
     */
    public get stop(): void {
        if (this.status === "idle") return;
        this.state = "idle";
    };


    /**
     * @description Проверяем можно ли читать плеер
     */
    public get hasPlayable() {
        if (this.status === "idle" || !this.connection) return false;

        //Если больше не читается, переходим в состояние Idle.
        if (!this.stream.readable) {
            this.state = "idle";
            return false;
        }

        return true;
    };


    /**
     * @description Передача пакетов в голосовые каналы
     * @param packet {null} Пакет
     */
    public set sendPacket(packet: Buffer) {
        if (this.connection?.state?.status !== "ready" || !packet) return;

        try {
            //Отправляем opus пакет
            if (AudioType === "opus") this.connection.playOpusPacket(packet);
            else { //Отправляем raw пакет
                this.connection.dispatchAudio();
                this.connection.prepareAudioPacket(packet);
            }
        } catch (err) {
            //Если возникает ошибка, то выключаем плеер
            this.emit("error", err, true);
        }
    };


    /**
     * @description Начинаем чтение стрима
     */
    public set readStream(options: {path: string, filters: (string | number)[], seek: number}) {
        const stream = new OpusAudio(options);

        stream.opus
            //Если происходит ошибка, то продолжаем читать этот же поток
            .once("error", () => this.emit("error", Error("Fail read stream"), false))
            //Включаем поток когда можно будет начать читать
            .once("readable", () => { this.state = stream });
    }


    /**
     * @description Удаляем ненужные данные
     */
    public cleanup = () => {
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop;

        this._stream = null;
        this._status = null;
        this._connection = null;
    };
}

/**
 * @description Ивенты которые плеер может вернуть
 */
interface PlayerEvents {
    //Плеер начал проигрывать аудио
    read: () => any;

    //Плеер закончил последние действие
    idle: () => any;

    //Плеер получил ошибку
    error: (error: Error, crash: boolean) => void;

    //Плеер встал на паузу
    pause: () => any;
}
type PlayerStatus = "read" | "pause" | "idle" | "error";