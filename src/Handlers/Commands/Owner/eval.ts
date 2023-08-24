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

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData => {
        const userCode = args.join(" ");
        const TimeStart = new Date().getMilliseconds();
        const { client } = message;
        const queue = client.queue.get(message.guild.id);

        try {
            const runEval = eval(userCode);
            return {
                embed: this.getEmbed(TimeStart, new Date().getMilliseconds(), userCode, runEval, Colors.Green)
            }
        } catch (err) {
            return {
                embed: this.getEmbed(TimeStart, new Date().getMilliseconds(), userCode, err, Colors.Green)
            }
        }
    };

    /**
     * @description Получаем EMBED
     * @param start {number} Время начала выполнения
     * @param end {number} Время конца выполнения
     * @param userCode {string} Код пользователя
     * @param Eval {string} Что было получено в ходе выполнения кода
     * @param color {number} Цвет EMBED
     */
    private getEmbed = (start: number, end: number, userCode: string, Eval: string, color: number) => {
        return {
            color, footer: { text: `Time: ${end - start} ms` }, fields:
                [
                    { name: "Input Code:", value: `\`\`\`js\n${userCode}\n\`\`\``, inline: false },
                    { name: "Output Code:", value: `\`\`\`js\n${Eval}\`\`\``, inline: false }
                ]
        };
    };
}