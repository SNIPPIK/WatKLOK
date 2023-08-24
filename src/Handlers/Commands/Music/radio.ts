import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";

export default class extends Command {
    public constructor() {
        super({
            name: "radio",
            aliases: ["rm"],
            description: "Режим радио!",

            permissions: {
                user: ["Administrator"],
                client: ["Speak", "Connect"]
            }
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { author, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        queue.options.radioMode = !queue.options.radioMode;

        return { text: `${author}, 📻 | RadioMode: ${queue.options.radioMode}`, color: "Green" };
    };
}