import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Constructor, handler} from "@handler";

/**
 * @class Command_Eval
 * @description Стандартная команда eval
 * @param query - Js код
 */
class Command_Eval extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "eval",
            description: "Выполнение JavaScript кода!",
            options: [
                {
                    name: "query",
                    description: "Нужен JavaScript код!",
                    required: true,
                    type: ApplicationCommandOptionType["String"]
                },
            ],
            owner: true,
            execute: (message, args) => {
                const userCode = args.join(" ");
                const TimeStart = new Date().getMilliseconds();
                const { client } = message;

                try {
                    const runEval = eval(userCode);
                    return {
                        embeds: [this._getEmbed(TimeStart, new Date().getMilliseconds(), userCode, runEval, Colors.Green)]
                    }
                } catch (err) {
                    return {
                        embeds: [this._getEmbed(TimeStart, new Date().getMilliseconds(), userCode, err, Colors.Green)]
                    }
                }
            }
        });
    };

    /**
     * @description Получаем EMBED
     * @param start {number} Время начала выполнения
     * @param end {number} Время конца выполнения
     * @param userCode {string} Код пользователя
     * @param Eval {string} Что было получено в ходе выполнения кода
     * @param color {number} Цвет EMBED
     */
    private _getEmbed = (start: number, end: number, userCode: string, Eval: string, color: number) => {
        return {
            color, footer: { text: `Time: ${end - start} ms` }, fields:
                [
                    { name: "Input Code:", value: `\`\`\`js\n${userCode}\n\`\`\``, inline: false },
                    { name: "Output Code:", value: `\`\`\`js\n${Eval}\`\`\``, inline: false }
                ]
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Eval});