import {Command, ResolveData} from "@Structures/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {Queue} from "@Queue/Queue";

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
        const {author, guild, client} = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        queue.options.radioMode = !queue.options.radioMode;

        return { text: `${author}, 📻 | RadioMode: ${queue.options.radioMode}`, color: "Green" };
    };
}