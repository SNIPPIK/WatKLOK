import { ApplicationCommandOptionType } from "discord.js";
import {Song} from "@watklok/player/queue/Song";
import {Assign, Command} from "@handler";
import {db} from "@Client/db";
import {Logger} from "@Client";

export default class extends Assign<Command> {
    public constructor() {
        super({
            name: "skip",
            description: "Пропуск текущей музыки!",

            options: [{
                name: "value",
                description: "Укажите какую музыку пропускаем!",
                type: ApplicationCommandOptionType["String"]
            }],

            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                if (isNaN(arg)) return { content: `${author}, аргумент не является числом` };

                let {player, songs} = queue, {title}: Song = songs[arg - 1];

                try {
                    //Если музыку нельзя пропустить из-за плеера
                    if (!player.playing) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                    //Если пользователь укажет больше чем есть в очереди
                    else if (arg > songs.length) return { content: `${author}, В очереди ${songs.length}!`, color: "Yellow" };

                    else if (arg > 1) {
                        if (queue.loop === "songs") for (let i = 0; i < arg - 2; i++) songs.push(songs.shift());
                        else queue.songs.splice(arg - 2, 1);
                    }

                    player.stop();
                    return arg > 1 ? { content: `⏭️ | Skip to song [${args}] | ${title}`, codeBlock: "css", color: "Green" } : { content: `⏭️ | Skip song | ${title}`, codeBlock: "css", color: "Green" }
                } catch (err) {
                    Logger.log("ERROR", err);
                    return { content: `${author}, Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
                }
            }
        });
    };
}