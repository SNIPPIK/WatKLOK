import { VoiceConnection, getVoiceConnection, getVoiceConnections, joinVoiceChannel } from "@discordjs/voice";
import { ChannelType, Guild, StageChannel, VoiceChannel } from "discord.js";
import {Logger} from "@Utils/Logger";

type Channels = VoiceChannel | StageChannel;
const Group = "A";

export const Voice = new class {
    /**
     * @description Подключение к голосовому каналу
     * @param channel {Channels} Канал к которому надо подключится
     */
    public readonly join = (channel: Channels): VoiceConnection => {
        //Подключаемся к голосовому каналу
        const connection = joinVoiceChannel({
            selfDeaf: true, selfMute: false, group: Group, channelId: channel.id, guildId: channel.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator
        });

        const me = channel.guild.members?.me;
        //Для голосовых трибун
        if (channel.type !== ChannelType.GuildVoice && me) me?.voice?.setRequestToSpeak(true).catch(Logger.error);

        return connection;
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