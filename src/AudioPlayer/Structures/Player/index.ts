import { PlayerCycle } from "@Structures/LifeCycle";
import { VoiceConnection } from "@discordjs/voice";
import { TypedEmitter } from "tiny-typed-emitter";
import { OpusAudio } from "@Media/OpusAudio";
import { Music } from "@db/Config.json";

export { AudioPlayer, SilenceFrame };
//====================== ====================== ====================== ======================


const SilenceFrame = Buffer.from([0xf8, 0xff, 0xfe, 0xfae]);
const packetSender = Music.AudioPlayer.methodSendPackets;
const SkippedStatuses = ["read", "pause"];
const UpdateMessage = ["read"];

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
    //====================== ====================== ====================== ======================
    /**
     * @description Общее время проигрывания музыки
     */
    public get streamDuration() { return this.state?.stream?.duration ?? 0 };
    //====================== ====================== ====================== ======================
    /**
     * @description Текущий статус плеера
     */
    public get state() { return this._state; };
    //====================== ====================== ====================== ======================
    /**
     * @description Все голосовые каналы к которым подключен плеер
     */
    public get connection() { return this._connection; };
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
     * @description Меняем голосовое подключение
     */
    public set connection(connection: VoiceConnection) { this._connection = connection; };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняем статус плеера
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
        if (oldStatus !== newStatus || oldStatus !== "idle" && newStatus === "read") {
            PlayerCycle.toRemove(this);
            this.emit(newStatus);
        }

        //Добавляем плеер в CycleStep
        PlayerCycle.toPush(this);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Ставим на паузу плеер
     */
    public pause = (): void => {
        if (this.state.status !== "read") return;
        this.state = { ...this.state, status: "pause" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем с паузы плеер
     */
    public resume = (): void => {
        if (this.state.status !== "pause") return;
        this.state = { ...this.state, status: "read" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Останавливаем воспроизведение текущего трека
     */
    public stop = (): void => {
        if (this.state.status === "idle") return;
        this.state = { status: "idle" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Начинаем чтение стрима
     * @param stream
     */
    public readStream = (stream: PlayerStatus["stream"]): void => {
        if (!stream) return void this.emit("error", Error(`Stream is null`), true);

        //Если прочитать возможно
        if (stream.readable) this.state = { status: "read", stream };
        else {
            //Включаем поток когда можно будет начать читать
            stream.opus.once("readable", () => {
                this.state = { status: "read", stream };
            });
            //Если происходит ошибка, то продолжаем читать этот же поток
            stream.opus.once("error", () => this.emit("error", Error("Fail read stream"), true));
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Передача пакетов в голосовые каналы
     * @param packet {null} Пакет
     */
    private sendPacket = (packet: Buffer): void => {
        const voiceConnection = this.connection;

        //Если голосовой канал готов
        if (voiceConnection.state.status === "ready") {
            //Пока есть возможность выбрать только 2 (djs, new)
            switch (packetSender) {
                //Если пользователь указал старый тип отправки
                case "djs": {
                    voiceConnection.dispatchAudio();
                    voiceConnection.prepareAudioPacket(packet);
                    break;
                }
                //Если пользователь указал что-то угодно кроме djs
                default: voiceConnection.playOpusPacket(packet);
            }
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем можно ли отправить пакет в голосовой канал
     */
    protected preparePacket = (): void => {
        const state = this.state;

        //Если статус (idle или pause или его нет) прекратить выполнение функции
        if (state?.status === "idle" || state?.status === "pause" || !state?.status) return;

        //Если вдруг нет голосового канала
        if (!this.connection) {
            this.state = { ...state, status: "pause" };
            return;
        }

        //Отправка музыкального пакета
        if (state.status === "read") {
            const packet: Buffer | null = state.stream?.read();

            if (packet) return this.sendPacket(packet);
            this.connection.setSpeaking(false);
            this.stop();
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаление неиспользованных данных
     */
    public destroy = (status: "all" | "stream" = "all"): void => {
        if (status === "all") {
            this.removeAllListeners();

            //Выключаем плеер если сейчас играет трек
            this.stop();

            this._connection = null;
            this._state = null;

            PlayerCycle.toRemove(this);
        } else {
            if (this.state?.stream) {
                if (this.state.stream?.opus) {
                    //Очищаемся от прошлого потока
                    this.state.stream.opus.removeAllListeners();
                    this.state.stream.opus.destroy();
                    this.state.stream.opus.read(); //Устраняем утечку памяти

                    //Устраняем фриз после смены потока
                    this.sendPacket(SilenceFrame);
                }

                this.state.stream.destroy();
            }
        }
    };
};
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