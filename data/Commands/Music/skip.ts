import { Command, ResolveData } from "@Client/Command";
import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Logger } from "@Logger";

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

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);
        const arg = args.length > 1 ? parseInt(args.pop()) : 1;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        if (isNaN(arg)) return { text: `${author}, аргумент не является числом` };

        try {
            return void client.player.skip(message, arg);
        } catch (err) {
            Logger.error(err);
            return { text: `${author}, Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
        }
    };
}