import {ChannelType, InternalDiscordGatewayAdapterCreator, StageChannel, VoiceChannel} from "discord.js";
import {DiscordGatewayAdapterCreator, getVoiceConnection, joinVoiceChannel} from "@discordjs/voice";
import {EventEmitter} from "node:events";
import {Queue} from "./Queue/Queue";
import {AudioPlayer} from "../Audio/AudioPlayer";

const VoiceDestroyTime = 30; //Очередь будет удалена автоматически через <VoiceDestroyTime> секунд

//Допустимые голосовые каналы
type VoiceChannels = VoiceChannel | StageChannel;
/**
 * @description Подключаемся к голосовому каналу
 * @param id {string} ID канала
 * @param guild {Guild} Сервер
 * @param type {string} Тип канала
 * @constructor
 */
export function JoinVoiceChannel({id, guild, type}: VoiceChannels) {
    const JoinVoice = joinVoiceChannel({
        selfDeaf: true,
        selfMute: false,
        channelId: id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as InternalDiscordGatewayAdapterCreator & DiscordGatewayAdapterCreator,
    });
    const me = guild.members?.me;

    if (type !== ChannelType.GuildVoice && me) me?.voice?.setRequestToSpeak(true).catch(() => undefined);

    return JoinVoice;
}
//====================== ====================== ====================== ======================
/**
 * @description Отключаемся от канала
 * @param channel {VoiceChannels | string} ID канала или сам канал
 * @constructor
 */
export function DisconnectVoiceChannel(channel: VoiceChannels | string) {
    const VoiceConnection = getVoiceConnection(typeof channel === "string" ? channel : channel.id);

    if (VoiceConnection) VoiceConnection.disconnect();
}
//====================== ====================== ====================== ======================

export class AutoDisconnectVoiceChannel extends EventEmitter {
    #Timer: NodeJS.Timeout;
    #state: boolean;

    public constructor() {
        super();
        this.on("StartQueueDestroy", this.#onStartQueueDestroy);
        this.on("CancelQueueDestroy", this.#onCancelQueueDestroy);
        this.setMaxListeners(2);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем таймер (по истечению таймера будет удалена очередь)
     * @param queue {object} Очередь сервера
     */
    #onStartQueueDestroy = (queue: Queue): void => {
        if (!queue) return null;

        const {player, events, channels} = queue;

        if (!this.#Timer) this.#Timer = setTimeout(() => events.queue.emit("DestroyQueue", queue, channels.message, false), VoiceDestroyTime * 1e3);
        this.#state = true;
        player.pause();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем таймер который удаляет очередь
     * @param player {AudioPlayer} Плеер
     */
    #onCancelQueueDestroy = (player: AudioPlayer): boolean | void => {
        if (this.#state) {
            this.#state = false;

            if (this.#Timer) clearTimeout(this.#Timer);
            player.resume();
        }
    };

    public destroy = () => {
        clearTimeout(this.#Timer);
        this.removeAllListeners();
    };
}