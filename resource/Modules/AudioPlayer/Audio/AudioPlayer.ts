import { VoiceConnection } from "@discordjs/voice";
import { TypedEmitter } from "tiny-typed-emitter";
import { OpusAudio } from "./Media/OpusAudio";
import {PlayerCycle} from "@Client/Cycles/Players";

export { AudioPlayer };

const SilenceFrame = Buffer.from([0xf8, 0xff, 0xfe, 0xfae]);
const SkippedStatuses = ["read", "pause"];
const UpdateMessage = ["read"];

const CyclePlayers = new PlayerCycle();

class AudioPlayer extends TypedEmitter<PlayerEvents> {
    /**
     * @description Голосовое подключение к каналу
     */
    private _connection: VoiceConnection;
    //====================== ====================== ====================== ======================
    /**
     * @description Статус плеера
     */
    private _state: PlayerStatus = { status: "idle" };
    //====================== ====================== ====================== ======================
    /**
     * @description Общее время проигрывания музыки
     */
    public get duration() { return this.state?.stream?.duration ?? 0 };
    //====================== ====================== ====================== ======================
    /**
     * @description Текущий статус плеера
     */
    public get state() { return this._state; };
    //====================== ====================== ====================== ======================
    /**
     * @description Все голосовые каналы к которым подключен плеер
     */
    public get connection() { return this._connection ?? undefined; };
    //====================== ====================== ====================== ======================
    /**
     * @description Возможно ли сейчас пропустить трек
     */
    public get hasSkipped() { return SkippedStatuses.includes(this.state.status); };
    //====================== ====================== ====================== ======================
    /**
     * @description Можно ли обновить сообщение
     */
    public get hasUpdate() { return UpdateMessage.includes(this.state.status); };
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем можно ли читать плеер
     */
    public get hasPlayable() {
        const state = this._state;
        if (state.status === "idle" || !this.connection) return false;

        //Если поток уничтожен или больше не читается, переходим в состояние Idle.
        if (!state.stream.readable) { this.state = { status: "idle" }; return false; }

        return true;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Передача пакетов в голосовые каналы
     * @param packet {null} Пакет
     */
    public set sendPacket(packet: Buffer) {
        const voiceConnection = this.connection;

        //Если голосовой канал готов
        if (voiceConnection?.state?.status === "ready") voiceConnection.playOpusPacket(packet);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняем голосовое подключение
     * @param connection {VoiceConnection} Голосове подключение
     */
    public set connection(connection: VoiceConnection) { this._connection = connection; };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняем статус плеера
     * @param newState {PlayerStatus} Новый данные плеера
     */
    public set state(newState: PlayerStatus) {
        const oldState = this._state;
        const oldStatus = oldState.status, newStatus = newState.status;

        //Проверяем на нужный статус, удаляем старый поток
        if (oldState.stream && !oldState.stream.destroyed && (newState.status === "idle" || oldState.stream !== newState.stream)) this.destroy("stream");

        //Перезаписываем state
        this._state = null;
        this._state = newState;

        //Фильтруем статусы бота что в emit не попало что не надо
        if (oldStatus !== newStatus || oldStatus !== "idle" && newStatus === "read") this.emit(newStatus);

        //Добавляем плеер в CycleStep
        CyclePlayers.push = this;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Начинаем чтение стрима
     * @param stream {OpusAudio} Поток который будет вопроизведен на сервере
     */
    public set readStream(stream: OpusAudio) {
        if (!stream) { this.emit("error", Error(`Stream is null`), true); return; }

        //Если прочитать возможно
        if (stream.readable) this.state = { status: "read", stream };
        else {
            //Включаем поток когда можно будет начать читать
            stream.opus.once("readable", () => { this.state = { status: "read", stream }; });
            //Если происходит ошибка, то продолжаем читать этот же поток
            stream.opus.once("error", () => this.emit("error", Error("Fail read stream"), true));
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Ставим на паузу плеер
     */
    public get pause(): void {
        if (this.state.status !== "read") return;
        this.state = { ...this.state, status: "pause" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем с паузы плеер
     */
    public get resume(): void {
        if (this.state.status !== "pause") return;
        this.state = { ...this.state, status: "read" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Останавливаем воспроизведение текущего трека
     */
    public get stop(): void {
        if (this.state.status === "idle") return;
        this.state = { status: "idle" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаление неиспользованных данных
     */
    public destroy = (status: "all" | "stream" = "all"): void => {
        if (status === "all") {
            this.removeAllListeners();

            //Выключаем плеер если сейчас играет трек
            this.stop;

            this._connection = null;
            this._state = null;

            //Удаляем плеер из CycleStep
            CyclePlayers.remove = this;
        } else {
            if (this.state?.stream) {
                if (this.state.stream?.opus) {
                    //Очищаемся от прошлого потока
                    this.state.stream.opus.removeAllListeners();
                    this.state.stream.opus.destroy();
                    this.state.stream.opus.read(); //Устраняем утечку памяти

                    //Устраняем фриз после смены потока
                    this.sendPacket = SilenceFrame;
                }

                this.state.stream.destroy();
            }
        }
    };
}
//====================== ====================== ====================== ======================
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
//====================== ====================== ====================== ======================
/**
 * @description Статусы и тип потока
 */
interface PlayerStatus {
    //Текущий статус плеера
    status: "read" | "pause" | "idle" | "error";
    //OggOpus Конвертер
    stream?: OpusAudio;
}