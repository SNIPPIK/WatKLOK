import {Assign, Event} from "@handler";
import {Events} from "discord.js";
import {db} from "@Client/db"

/**
 * @author SNIPPIK
 * @description Класс ивента VoiceStateUpdate
 * @class VoiceStateUpdate
 */
export default class VoiceStateUpdate extends Assign<Event<Events.VoiceStateUpdate>> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            type: "client",
            execute: (client, oldState, newState) => {
                const Guild = oldState.guild;
                const voice = db.queue.voice.getVoice(Guild.id);
                const ChannelID = oldState?.channel?.id || newState?.channel?.id;

                /**
                 * @description Если есть голосовое подключение и нет слушателей то отключаемся
                 */
                if (Guild && voice) {
                    const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;

                    if (voice && usersSize < 1 && voice.joinConfig.channelId === oldState?.channelId) db.queue.voice.removeVoice(voice);
                }

                /**
                 * @description Если есть очередь и нет слушателей то удаляем очередь
                 */
                const queue = db.queue.get(newState.guild.id);

                if (queue) {
                    const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;
                    const isBotVoice = !!(newState.channel?.members ?? oldState.channel?.members)?.find((member) => member.user.id === client.user.id);

                    if (usersSize < 1 && !isBotVoice) db.queue.remove(queue.guild.id);
                }
            }
        });
    };
}