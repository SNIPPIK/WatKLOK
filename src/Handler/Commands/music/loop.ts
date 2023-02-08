import {Command, ResolveData} from "@Structures/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {ApplicationCommandOptionType} from "discord.js";
import {Queue} from "@Queue/Queue";

export class LoopCommand extends Command {
    public constructor() {
        super({
            name: "loop",
            aliases: ["repeat", "rept"],
            description: "Включение повтора и выключение повтора музыки!",

            usage: "song | Доступны: song, songs, off",
            options: [
                {
                    name: "type",
                    description: "Необходимо указать что-то из | song, on, off",
                    type: ApplicationCommandOptionType.String
                }
            ],

            isSlash: true,
            isEnable: true
        })
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const {author, member, guild} = message;
        const queue: Queue = message.client.queue.get(guild.id);

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "DarkRed"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "DarkRed" };

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        switch (args[0]) {
            case "выкл":
            case "off":
                queue.options.loop = "off";
                return { text: `❌ | Повтор выключен`, codeBlock: "css" };

            case "вкл":
            case "on":
                queue.options.loop = "songs";
                return { text: `🔁 | Повтор всей музыки`, codeBlock: "css" };

            case "one":
            case "1":
            case "song":
                queue.options.loop = "song";
                return { text: `🔂 | Повтор  | ${queue.songs[0].title}`, codeBlock: "css", color: queue.songs[0].color };
            default:
                queue.options.loop = queue.options.loop !== "songs" ? "songs" : "off";
                return { text: `🎶 | Повтор ${queue.options.loop}`, codeBlock: "css" };
        }
    };
}