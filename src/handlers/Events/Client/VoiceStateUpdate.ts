import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {Voice} from "@lib/voice";
import {Logger} from "@env";
import {db} from "@lib/db"

/**
 * @author SNIPPIK
 * @description Класс ивента VoiceStateUpdate
 * @class VoiceStateUpdate
 */
class VoiceStateUpdate extends Constructor.Assign<Handler.Event<Events.VoiceStateUpdate>> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            type: "client",
            execute: (client, oldState, newState) => setImmediate(() => {
                const Guild = oldState.guild, ChannelID = oldState?.channel?.id || newState?.channel?.id;
                const me = (newState.channel?.members ?? oldState.channel?.members).get(client.user.id);
                const isChannel = me?.voice && (oldState.channelId ?? newState.channelId) === me.voice.channelId;

                //Если нет сервера или канала, то ничего не делаем
                if (!Guild || !ChannelID || !isChannel) return;

                //Фильтруем пользователей
                let size = 0;
                for (const [_, member] of (newState.channel?.members ?? oldState.channel?.members)) {
                    if (member.user.bot) continue;
                    size++;
                }

                const queue = db.audio.queue.get(newState.guild.id);
                
                //Если нет пользователей
                if (size < 1) {
                    if (queue) db.audio.queue.remove(queue.guild.id);
                    Voice.remove(Guild.id);
                }
            })
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({VoiceStateUpdate});
