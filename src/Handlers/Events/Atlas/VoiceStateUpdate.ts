import {getVoiceConnection} from "@discordjs/voice";
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

                /**
                 * @description Если есть голосовое подключение и нет слушателей то отключаемся
                 */
                if (Guild) {
                    const voice = getVoiceConnection(Guild.id);

                    if (!voice) return;

                    const ChannelID = oldState?.channel?.id || newState?.channel?.id;
                    const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;

                    if (voice && usersSize < 1 && voice.joinConfig.channelId === oldState?.channelId) voice.disconnect();

                    /**
                     * @description Если есть очередь и нет слушателей то удаляем очередь
                     */
                    const queue = db.queue.get(newState.guild.id);

                    if (queue) {
                        const isBotVoice = !!(newState.channel?.members ?? oldState.channel?.members)?.find((member) => member.user.id === client.user.id);

                        if (usersSize < 1 && !isBotVoice) db.queue.remove(queue.guild.id);
                    }
                }
            }
        });
    };
}