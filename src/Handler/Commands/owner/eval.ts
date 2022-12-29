import {ClientMessage, EmbedConstructor} from "@Client/interactionCreate";
import {Command, ResolveData} from "@Structures/Handle/Command";
import {Colors} from "discord.js";

export class Eval extends Command {
    public constructor() {
        super({
            name: "eval",
            aliases: ["el", "code", "js"],

            isEnable: true,
            isOwner: true,
            isSlash: false,
            isGuild: false
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const queue = message.client.queue.get(message.guild.id);
        const StartMs = new Date().getMilliseconds();
        const Code = args.join(" ");
        const resolve = (Eval: string, EndMs: number, color: number): EmbedConstructor => {
            return { color, footer: { text: `Time: ${EndMs - StartMs} ms` }, fields:
                    [
                        { name: "Input Code:", value: `\`\`\`js\n${Code}\n\`\`\``, inline: false },
                        { name: "Output Code:", value: `\`\`\`js\n${Eval}\`\`\``, inline: false }
                    ]
            };
        };

        try {
            const EvalCode = eval(Code);
            const EndMs = new Date().getMilliseconds();
            return {embed: resolve(EvalCode, EndMs, Colors.Green)};
        } catch (e) {
            const EndMs = new Date().getMilliseconds();
            return {embed: resolve(e, EndMs, Colors.Red)};
        }
    };
}