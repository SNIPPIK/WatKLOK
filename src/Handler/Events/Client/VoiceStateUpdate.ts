import {getVoiceConnection} from "@discordjs/voice";
import {db} from "@components/QuickDB";
import {Events} from "discord.js";
import {Event} from "@handler";

/**
 * @author SNIPPIK
 * @description Класс ивента VoiceStateUpdate
 * @class VoiceStateUpdate
 */
export default class VoiceStateUpdate extends Event<Events.VoiceStateUpdate> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            execute: (client, oldState, newState) => {
                const ChannelID = oldState?.channel?.id || newState?.channel?.id;
                const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;
                const Guild = oldState.guild;

                /**
                 * @description Если есть голосовое подключение и нет слушателей то отключаемся
                 */
                if (Guild) {
                    const voice = getVoiceConnection(Guild.id);

                    //Если есть голосовое подключение и пользователей меньше одного и каналы соответствуют и выключен радио режим, то отключаемся от голосового канала
                    if (voice && usersSize < 1 && voice.joinConfig.channelId === oldState?.channelId) voice.disconnect();
                }

                /**
                 * @description Если есть очередь и нет слушателей то удаляем очередь
                 */
                const queue = db.music.queue.get(newState.guild.id); //Очередь сервера

                if (queue) {
                    const isBotVoice = !!(newState.channel?.members ?? oldState.channel?.members)?.find((member) => member.user.id === client.user.id);

                    if (usersSize < 1 && !isBotVoice) db.music.queue.remove(queue.guild.id);
                }
            }
        });
    };
}