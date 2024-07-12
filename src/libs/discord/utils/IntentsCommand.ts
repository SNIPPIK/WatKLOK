import {Client} from "@lib/discord";
import {locale} from "@lib/locale";
import {db} from "@lib/db";
import {LightMessageBuilder} from "@lib/discord/utils/MessageBuilder";

/**
 * @author SNIPPIK
 * @description Поддержка ---
 */
const intends: {[key: string]: (message: Client.message | Client.interact) => boolean | LightMessageBuilder["options"]} = {
    "voice": (message) => {
        const { author, member } = message;
        const VoiceChannel = member?.voice?.channel;
        if (!VoiceChannel)
            return {
                content: locale._(message.locale, "player.voice.inactive", [author]),
                color: "Yellow"
            };
        return false;
    },
    "queue": (message) => {
        const { author, guild } = message;
        const queue = db.audio.queue.get(guild.id);
        if (!queue)
            return {
                content: locale._(message.locale, "player.queue.null", [author]),
                color: "Yellow"
            };
        return false;
    },
    "anotherVoice": (message) => {
        const { author, member, guild } = message;
        const queue = db.audio.queue.get(guild.id);
        const VoiceChannel = member?.voice?.channel;
        if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel)
            return {
                content: locale._(message.locale, "player.voice.active", [author, queue.voice.id]),
                color: "Yellow"
            };
        return false;
    },
};

export type IntentsCommand = "voice" | "queue" | "anotherVoice";

/**
 * @author SNIPPIK
 * @description
 */
export class IntentCommand {
    /**
     * @description Проверяем команды на наличие
     * @param array
     * @param message
     */
    public static check = (array: IntentsCommand[], message: Client.message | Client.interact) => {
        if (!array || array?.length === 0) return;

        for (const key of array) {
            const intent = intends[key];
            if (!intent) continue;

            const data = intent(message);
            if (data) return data;
        }
    };
}