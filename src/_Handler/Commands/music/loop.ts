import { Command, ResolveData } from "@Handler/FileSystem/Handle/Command";
import { ClientMessage } from "@Client/interactionCreate";
import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@Queue/Queue";

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
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild } = message;
        const queue: Queue = message.client.queue.get(guild.id);

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        const argument = args?.pop()?.toLowerCase();
        let text = "";

        //Если пользователь выключаем повтор
        if (["off", "выкл"].includes(argument)) {
            queue.options.loop = "off";
            text = `❌ | Повтор выключен`;

            //Если пользователь включаем повтор    
        } else if (["on", "вкл"].includes(argument)) {
            queue.options.loop = "songs";
            text = `🔁 | Повтор всей музыки`;

            //Если пользователь включает повтор трека    
        } else if (["one", "1", "song"].includes(argument)) {
            queue.options.loop = "song";
            text = `🔂 | Повтор  | ${queue.songs[0].title}`;

            //Если пользователь не указал аргумент
        } else if (!argument) {
            queue.options.loop = queue.options.loop !== "songs" ? "songs" : "off";
            text = `🎶 | Повтор ${queue.options.loop}`;
        }

        return { text, codeBlock: "css" };
    };
}
