import {ApplicationCommandOptionType, Colors, EmbedData} from "discord.js";
import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "eval",
            description: "Выполнение JavaScript кода!",
            aliases: ["el", "code", "js"],
            options: [
                {
                    name: "query",
                    description: "Нужен JavaScript код!",
                    required: true,
                    type: ApplicationCommandOptionType.String
                },
            ],
            isOwner: true
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { client } = message;
        const queue = client.queue.get(message.guild.id);
        const StartMs = new Date().getMilliseconds();
        const Code = args.join(" ");

        const resolve = (Eval: string, EndMs: number, color: number): EmbedData => {
            return {
                color, footer: { text: `Time: ${EndMs - StartMs} ms` }, fields:
                    [
                        { name: "Input Code:", value: `\`\`\`js\n${Code}\n\`\`\``, inline: false },
                        { name: "Output Code:", value: `\`\`\`js\n${Eval}\`\`\``, inline: false }
                    ]
            };
        };

        try {
            const EvalCode = eval(Code);
            const EndMs = new Date().getMilliseconds();
            return { embed: resolve(EvalCode, EndMs, Colors.Green) };
        } catch (e) {
            const EndMs = new Date().getMilliseconds();
            return { embed: resolve(e, EndMs, Colors.Red) };
        }
    };
}