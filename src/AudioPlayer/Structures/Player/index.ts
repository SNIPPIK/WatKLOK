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
    private _connection: VoiceConnection;
    private _state: PlayerStatus = { status: "idle" };

    //====================== ====================== ====================== ======================
    /**
     * @description Общее время проигрывания музыки
     */
    public get streamDuration() { return this.state?.stream?.duration ?? 0 };
    //====================== ====================== ====================== ======================
    /**
     * @description Все голосовые каналы к которым подключен плеер
     */
    public get connection() { return this._connection; };
    public set connection(voice: VoiceConnection) { this._connection = voice; };
    //====================== ====================== ====================== ======================
    /**
     * @description Смена действий плеера
     */
    public get state() { return this._state; };
    public set state(state: PlayerStatus) {
        const oldState = this._state;
        const oldStatus = oldState.status, newStatus = state.status;

        //Проверяем на нужный статус, удаляем старый поток
        if (isDestroy(oldState, state)) {
            //Очищаемся от прошлого потока
            oldState.stream.opus.removeAllListeners();
            oldState.stream.opus.destroy();
            oldState.stream.opus.read(); //Устраняем утечку памяти
            oldState.stream.destroy();

            //Устраняем фриз после смены потока
            this.sendPacket(SilenceFrame);
        }

        //Перезаписываем state
        delete this._state;
        this._state = state;        

        //Если не получается отправить пакеты
        if (newStatus === "autoPause") {
            if (this.connection) this.emit("error", Error(`[VoiceConnection]: has state ${this.connection.state.status}!`), false);
            else this.emit("error", Error(`[VoiceConnection]: has not found!`), false);
        }

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
        if (state.status === "idle") return false;

        //Если поток уничтожен или больше не читается, переходим в состояние Idle.
        if (!state.stream.readable) { this.state = { status: "idle" }; return false; }

        return true;
    }
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
    public sendPacket = (packet: Buffer): void => {
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
        if (state.status === "idle" || state.status === "pause" || !state?.status) return;

        //Если некуда проигрывать музыку ставить плеер на паузу
        if (!this.connection) return void (this.state = { ...state, status: "autoPause" });
        else if (this.state.status === "autoPause" && this.connection && this.connection.state.status === "ready") {
            //Если стоит статус плеера (autoPause) и есть канал или каналы в которые можно воспроизвести музыку, стартуем!
            this.state = { ...this.state, status: "read", stream: this.state.stream };
        }

        //Не читать пакеты при статусе плеера (autoPaused)
        if (state.status === "autoPause") return;

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
    public destroy = (): void => {
        this.removeAllListeners();

        //Выключаем плеер если сейчас играет трек
        this.stop();

        delete this._connection;
        delete this._state;

        PlayerCycle.toRemove(this);
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Аргументы для удаления аудио потока
 */
function isDestroy(oldS: PlayerStatus, newS: PlayerStatus): boolean {
    if (!oldS.stream || oldS.stream?.destroyed) return false;

    if ((oldS.status === "read" && newS.status === "pause" || oldS.status === "pause" && newS.status === "read") && oldS.stream === newS.stream) return false;
    else if (oldS.status !== "idle" && newS.status === "read") return true;
    else if (oldS.status === "read" && newS.status === "idle") return true;

    return false;
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
    //Плеер не находит <player>.voice или проблема с подключение к голосовому каналу
    autoPause: (error?: Error | string) => any;
}
//====================== ====================== ====================== ======================
/**
 * @description Статусы и тип потока
 */
interface PlayerStatus {
    //Текущий статус плеера
    status: "read" | "pause" | "idle" | "error" | "autoPause";
    //OggOpus Конвертер
    stream?: OpusAudio;
}