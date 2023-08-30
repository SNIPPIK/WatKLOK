import {getVoiceConnection, getVoiceConnections, joinVoiceChannel, VoiceConnection} from "@discordjs/voice";
import {Guild, StageChannel, VoiceChannel} from "discord.js";
import {env} from "@env";
import {Logger} from "@Logger";

type Channels = VoiceChannel | StageChannel;
const Group = "W", debug = env.get("debug.voice");

export const Voice = new class {
    /**
     * @description Подключение к голосовому каналу
     * @param channel {Channels} Канал к которому надо подключится
     */
    public readonly join = (channel: Channels): VoiceConnection => {
        if (debug) Logger.debug(`[Voice]: join | ${channel.id}/${channel.name}`);

        return joinVoiceChannel({
            selfDeaf: true, selfMute: false, group: Group, channelId: channel.id, guildId: channel.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator
        });
    };


    /**
     * @description Отключаемся от канала
     * @param guild {Channels | string} ID канала или сам канал
     */
    public readonly disconnect = (guild: Guild | string): void => {
        const ID = typeof guild === "string" ? guild : guild.id;
        const VoiceConnection = this.getVoice(ID);

        //Если бот подключен к голосовому каналу, то отключаемся!
        if (VoiceConnection) {
            if (debug) Logger.debug(`[Voice]: disconnect | ${VoiceConnection.joinConfig.channelId}`);

            VoiceConnection.removeAllListeners();
            VoiceConnection.disconnect();

            //Удаляем канал из базы
            getVoiceConnections(Group)?.delete(ID);
        }
    };


    /**
     * @description Получаем голосовое подключение
     * @param guildID {string} ID сервера
     */
    public readonly getVoice = (guildID: string): VoiceConnection => getVoiceConnection(guildID, Group);
}