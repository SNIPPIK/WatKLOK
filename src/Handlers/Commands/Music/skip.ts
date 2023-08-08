import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {Song} from "@AudioPlayer/Queue/Song";
import { Logger } from "@Logger";

export default class extends Command {
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
            }]
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);
        const arg = args.length > 1 ? parseInt(args.pop()) : 1;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        if (isNaN(arg)) return { text: `${author}, аргумент не является числом` };

        const {player, songs, options} = queue;
        const {title}: Song = songs[arg - 1];

        try {
            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return { text: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

            //Если пользователь укажет больше чем есть в очереди
            if (arg > songs.length) return { text: `${author}, В очереди ${songs.length}!`, color: "Yellow" };

            if (arg > 1) {
                if (options.loop === "songs") for (let i = 0; i < arg - 2; i++) songs.push(songs.shift());
                else queue.songs = songs.slice(arg - 2);
            }

            player.stop;
            return arg > 1 ? { text: `⏭️ | Skip to song [${args}] | ${title}`, codeBlock: "css", color: "Green" } : { text: `⏭️ | Skip song | ${title}`, codeBlock: "css", color: "Green" }
        } catch (err) {
            Logger.error(err);
            return { text: `${author}, Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
        }
    };
}