import { Command, ResolveData } from "@Client/Command";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";

export class RadioCommand extends Command {
    public constructor() {
        super({
            name: "radio",
            aliases: ["rm"],
            description: "Режим радио!",

            permissions: {
                user: ["Administrator"],
                client: ["Speak", "Connect"]
            },

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        queue.options.radioMode = !queue.options.radioMode;

        return { text: `${author}, 📻 | RadioMode: ${queue.options.radioMode}`, color: "Green" };
    };
}