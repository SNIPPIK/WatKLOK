import {VoiceConnection} from "@discordjs/voice";

//Utils
import {TypedEmitter} from "@Emitter";
import {Logger} from "@Utils/Logger";

//Player
import {OpusAudio} from "./Opus";

//Client
import {PlayerCycle} from "@Client/Cycles";
import {env} from "@Client/Fs";

//For player
const CyclePlayers = new PlayerCycle();
const SkippedStatuses = ["read", "pause"];
const UpdateMessage = ["read"];

//env
const Debug: boolean = env.get("debug.player");
const AudioType = env.get("music.audio.type");

export class AudioPlayer extends TypedEmitter<PlayerEvents> {
    private _status: PlayerStatus = "idle";
    private _connection: VoiceConnection;
    private _stream: OpusAudio;

    /**
     * @description Общее время проигрывания музыки
     */
    public get duration() { return this.stream?.duration ?? 0 };


    /**
     * @description Задаём поток в плеер
     * @param newStream {OpusAudio} Новый поток или замена прошлому
     */
    public set stream(newStream: OpusAudio) {
        const oldStream = this._stream;

        if (Debug) Logger.debug(`AudioPlayer.stream has [${!!newStream}]`);

        //Проверяем на нужный статус, удаляем старый поток
        if (oldStream && !oldStream.destroyed && oldStream !== newStream) {
            this.sendPacket = Buffer.from([0xf8, 0xff, 0xfe, 0xfae]);
            oldStream.opus.emit("close");
        }

        //Если есть новый поток
        if (newStream) {
            this._stream = newStream;
            this.status = "read";
            return;
        }

        this._stream = null;
    };


    /**
     * @description Получаем текущий поток
     */
    public get stream() { return this._stream; };


    /**
     * @description Задаем голосовое подключение для отправления пакетов
     * @param connection {VoiceConnection} Голосовое подключение
     */
    public set connection(connection: VoiceConnection) {
        if (this._connection === connection) return;

        //Перезаписываем голосовое подключение
        this._connection = connection;
    };


    /**
     * @description Получаем голосовое подключение
     */
    public get connection() { return this._connection; };


    /**
     * @description Изменяем статус плеера
     * @param newStatus {PlayerStatus} Новый статус плеера
     */
    private set status(newStatus: PlayerStatus) {
        const oldStatus = this._status;

        this._status = newStatus;

        //Надо ли удалять плеер из базы
        if (newStatus === "idle") CyclePlayers.remove = this;
        else CyclePlayers.push = this;

        //Если статусы не совпадают, то делаем emit
        if (oldStatus !== newStatus) this.emit(newStatus);

        if (Debug) Logger.debug(`AudioPlayer.status: [${oldStatus} to ${newStatus}]`);
    };


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
        this.status = "pause";
    };


    /**
     * @description Убираем с паузы плеер
     */
    public get resume(): void {
        if (this.status !== "pause") return;
        this.status = "read";
    };


    /**
     * @description Останавливаем воспроизведение текущего трека
     */
    public get stop(): void {
        if (this.status === "idle") return;
        this.status = "idle";
    };


    /**
     * @description Проверяем можно ли читать плеер
     */
    public get hasPlayable() {
        if (this.status === "idle" || !this.connection) return false;

        //Если больше не читается, переходим в состояние Idle.
        if (!this.stream.readable) {
            this.status = "idle";
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

        if (AudioType === "opus") this.connection.playOpusPacket(packet);
        else {
            this.connection.dispatchAudio();
            this.connection.prepareAudioPacket(packet);
        }
    };


    /**
     * @description Начинаем чтение стрима
     * @param stream {OpusAudio} Поток который будет воспроизведен на сервере
     */
    public set exportStreamPlayer(stream: OpusAudio) {
        if (!stream) { this.emit("error", Error(`Stream is null`), true); return; }

        //Если прочитать возможно
        if (stream.readable) { this.stream = stream; return; }

        //Включаем поток когда можно будет начать читать
        stream.opus.once("readable", () => { this.stream = stream });
        //Если происходит ошибка, то продолжаем читать этот же поток
        stream.opus.once("error", () => this.emit("error", Error("Fail read stream"), true));
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
    error: (error: Error, skipSong: boolean) => void;

    //Плеер встал на паузу
    pause: () => any;
}
type PlayerStatus = "read" | "pause" | "idle" | "error";