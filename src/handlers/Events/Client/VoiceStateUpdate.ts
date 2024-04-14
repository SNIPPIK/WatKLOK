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
                const channel = oldState?.channel || newState?.channel;
                const me = channel.members.get(client.user.id);
                const guild = oldState.guild || newState.guild;

                //Если нет сервера или канала
                if (!guild || !channel) return;

                const members = channel.members.filter(member => !member.user.bot).size;
                const meVoice = me?.voice && channel?.id === me.voice.channelId;

                //Если кол-во пользователей менее 1 или нет бота в голосовом канале сервера
                if (members < 1 || !meVoice) {
                    const queue = db.audio.queue.get(newState.guild.id);

                    if (queue) {
                        //Если включен режим радио
                        if (queue.radio) {
                            if (queue.songs?.song?.duration?.seconds !== 0) return;
                            else if (members === 0) queue.player.pause();
                            else queue.player.resume();
                            return;
                        }

                        db.audio.queue.remove(queue.guild.id);
                    }

                    //Если бот находится в голосовом канале
                    if (meVoice) Voice.remove(guild.id);
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