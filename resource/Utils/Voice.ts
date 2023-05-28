import { VoiceConnection, getVoiceConnection, getVoiceConnections, joinVoiceChannel } from "@discordjs/voice";
import { ChannelType, Guild, StageChannel, VoiceChannel, VoiceState } from "discord.js";
import {Logger} from "@Logger";

type Channels = VoiceChannel | StageChannel;
const Group = "A";

class VoiceManager {
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
     * @description Все пользователи в голосовом канале
     * @param Guild {Guild} Сервер с которого надо взять данные
     */
    public readonly Members = (Guild: Guild): VoiceState[] | "Fail" => {
        const connection = this.getVoice(Guild.id), Users: VoiceState[] = [];

        if (connection) Guild.voiceStates.cache.forEach((state: VoiceState): void => {
            if (!(state.channelId === connection.joinConfig.channelId && state.guild.id === connection.joinConfig.guildId)) return;
            Users.push(state);
        });

        return Users.length > 0 ? Users : "Fail";
    };


    /**
     * @description Получаем голосовое подключение
     * @param guildID {string} ID сервера
     */
    public readonly getVoice = (guildID: string): VoiceConnection => getVoiceConnection(guildID, Group);
}
export const Voice = new VoiceManager();