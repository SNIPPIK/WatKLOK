import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {Voice} from "@lib/voice";
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
                const guild = oldState.guild || newState.guild;
                const channelID = oldState?.channel?.id || newState?.channel?.id;
                const me = (newState.channel?.members || oldState.channel?.members).get(client.user.id);
                const isChannel = me?.voice && (oldState.channelId || newState.channelId) === me.voice.channelId;

                if (!guild || !channelID || !isChannel) return;

                const nonBotMembers = (newState.channel?.members || oldState.channel?.members).filter(member => !member.user.bot).size;
                const queue = db.audio.queue.get(newState.guild.id);

                if (nonBotMembers < 1) {
                    if (queue) {
                        if (queue.radio) {
                            if (queue.songs?.song?.duration?.seconds !== 0) return;
                            else if (nonBotMembers === 0) queue.player.pause();
                            else queue.player.resume();
                            return;
                        }

                        db.audio.queue.remove(queue.guild.id);
                    }

                    Voice.remove(guild.id);
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