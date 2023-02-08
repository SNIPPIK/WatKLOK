import {Command, ResolveData} from "@Structures/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {ApplicationCommandOptionType} from "discord.js";
import {Queue} from "@Queue/Queue";

export class SkipCommand extends Command {
    public constructor() {
        super({
            name: "skip",
            aliases: ['s'],
            description: "Пропуск текущей музыки!",

            usage: "1 | Все треки будут пропущены до указанного | Если аргумент не указан, то будет пропущен текущий трек",
            options: [{
                name: "value",
                description: "Укажите какую музыку пропускаем!",
                type: ApplicationCommandOptionType.String
            }],

            isSlash: true,
            isEnable: true
        });
    };

    public readonly run = (message: ClientMessage, args: string[] = ["0"]): ResolveData => {
        const {author, member, guild, client} = message;
        const queue: Queue = client.queue.get(guild.id);
        const argsNum = parseInt(args[0]);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "DarkRed"
        };

        try {
            return void client.player.skip(message, args && args[0] && !isNaN(argsNum) ? argsNum : null);
        } catch {
            return { text: `${author}, Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
        }
    };
}