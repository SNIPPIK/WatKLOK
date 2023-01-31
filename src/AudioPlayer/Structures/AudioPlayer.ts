import {VoiceConnection} from "@discordjs/voice";
import {TypedEmitter} from "tiny-typed-emitter";
import {OpusAudio} from "@OpusAudio";
import {PlayerCycle} from "@Managers/Players/CycleStep";

const NotSkippedStatuses = ["read", "pause", "autoPause"];
const UpdateMessage = ["idle", "pause", "autoPause"];
const SilenceFrame = Buffer.from([0xf8, 0xff, 0xfe, 0xfae]);

//Ивенты которые плеер может вернуть
interface PlayerEvents {
    //Плеер начал проигрывать поток
    read: () => any;
    //Плеер встал на паузу
    pause: () => any;
    //Плеер не находит <player>.voice
    autoPause: () => any;
    //Плеер закончил последние действие
    idle: () => any;
    //Плеер получил ошибку
    error: (error: Error, skipSong: boolean) => void;
}

//Статусы и тип потока
interface PlayerStatus {
    //Текущий статус плеера
    status: "read" | "pause" | "idle" | "error" | "autoPause";
    //Текущий поток
    stream?: OpusAudio;
}

export class AudioPlayer extends TypedEmitter<PlayerEvents> {
    private _voice: VoiceConnection;
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
    public get voice() { return this._voice; };
    public set voice(voice) { this._voice = voice; };
    //====================== ====================== ====================== ======================
    /**
     * @description Смена действий плеера
     */
    public get state() { return this._state; };
    public set state(state) {
        const oldState = this._state;
        const oldStatus = oldState.status, newStatus = state.status;

        //Проверяем на нужный статус, удаляем старый поток
        if (isDestroy(oldState, state)) {
            oldState.stream.opus.removeAllListeners();
            oldState.stream.opus.destroy();
            oldState.stream.opus.read(); //Устраняем утечку памяти
            oldState.stream.destroy();
        }

        //Перезаписываем state
        delete this._state;
        this._state = state;

        //Заставляем ивенты работать
        if (oldStatus !== newStatus || oldStatus !== "idle" && newStatus === "read") {
            PlayerCycle.toRemove(this);
            this.sendPacket(SilenceFrame);
            this.emit(newStatus);
        }

        PlayerCycle.toPush(this);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Возможно ли сейчас пропустить трек
     */
    public get hasSkipped() { return NotSkippedStatuses.includes(this.state.status); };
    //====================== ====================== ====================== ======================
    /**
     * @description Можно ли обновить сообщение
     */
    public get hasUpdate() { return UpdateMessage.includes(this.state.status); };
    //====================== ====================== ====================== ======================
    //Ставим на паузу плеер
    public pause = (): void => {
        if (this.state.status !== "read") return;
        this.state = {...this.state, status: "pause"};
    };
    //Убираем с паузы плеер
    public resume = (): void => {
        if (this.state.status !== "pause") return;
        this.state = {...this.state, status: "read"};
    };
    //Останавливаем воспроизведение текущего трека
    public stop = (): void => {
        if (this.state.status === "idle") return;
        this.state = {status: "idle"};
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Начинаем чтение стрима
     * @param url {string}
     * @param options {seek: number, filter: any[]}
     */
    public readStream = (url: string, options: {seek: number, filters: any[]}): void => {
        if (!url) return void this.emit("error", new Error(`Link to resource, not found`), true);

        const stream = new OpusAudio(url, options);

        if (!stream) return void this.emit("error", new Error(`Stream is null`), true);

        //Если прочитать возможно
        if (stream.readable) this.state = {status: "read", stream};
        else {
            //Включаем поток когда можно будет начать читать
            stream.opus.once("readable", () => {
                this.sendPacket(SilenceFrame);
                this.state = {status: "read", stream};
            });
            //Если происходит ошибка, то продолжаем читать этот же поток
            stream.opus.once("error", () => this.emit("error", new Error("Fail read stream"), true));
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Передача пакетов в голосовые каналы
     * @param packet {null} Пакет
     * @private
     */
    public sendPacket = (packet: Buffer | null) => {
        const voiceConnection = this.voice;

        if (packet && voiceConnection.state.status === "ready") voiceConnection.playOpusPacket(packet);
        else voiceConnection.setSpeaking(false);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем можно ли отправить пакет в голосовой канал
     */
    protected preparePacket = () => {
        const state = this.state;

        //Если статус (idle или pause) прекратить выполнение функции
        if (state?.status === "pause" || state?.status === "idle" || !state?.status) return;

        if (!this.voice) {
            this.state = {...state, status: "pause"};
            return;
        } else if (state.status === "autoPause") {
            //Если стоит статус плеера (autoPause) и есть канал или каналы в которые можно воспроизвести музыку, стартуем!
            this.state = {...state, status: "read", stream: state.stream};
        }

        //Не читать пакеты при статусе плеера (autoPause)
        if (state.status === "autoPause") return;

        //Отправка музыкального пакета
        if (state.status === "read") {
            const packet: Buffer | null = state.stream?.read();

            if (packet) this.sendPacket(packet);
            else this.stop();
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаление неиспользованных данных
     */
    public destroy = () => {
        this.removeAllListeners();

        //Выключаем плеер если сейчас играет трек
        this.stop();

        delete this._voice;
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