import { ApplicationCommandOptionType } from "discord.js";
import {Command, Constructor} from "@handler";
import {Logger} from "@Client";
import {db} from "@Client/db";

/**
 * @class Command_Skip
 * @command skip
 * @description Пропуск текущей музыки или под номером!
 * @param value - Номер пропускаемого трека
 */
class Command_Skip extends Constructor.Assign<Command> {
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

                let {player, songs} = queue, {title} = songs[arg - 1];

                try {
                    //Если музыку нельзя пропустить из-за плеера
                    if (!player.playing) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                    //Если пользователь укажет больше чем есть в очереди
                    else if (arg > songs.length && arg < queue.songs.length) return { content: `${author}, В очереди ${songs.length}!`, color: "Yellow" };

                    else if (arg > 1) {
                        if (queue.repeat === "songs") for (let i = 0; i < arg - 2; i++) songs.push(songs.shift());
                        else queue.songs.splice(arg - 2, 1);
                    }

                    player.stop();
                    return arg > 1 ? { content: `⏭️ | Skip to song [${arg}] | ${title}`, codeBlock: "css", color: "Green" } : { content: `⏭️ | Skip song | ${title}`, codeBlock: "css", color: "Green" }
                } catch (err) {
                    Logger.log("ERROR", err);
                    return { content: `${author}, Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
                }
            }
        });
    };
}

/**
 * @class Command_Remove
 * @command remove
 * @description Эта команда удаляет из очереди музыку под указанным номером!
 * @param value - Номер трека который будет удален из очереди
 */
class Command_Remove extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "remove",
            description: "Эта команда удаляет из очереди музыку!",

            options: [
                {
                    name: "value",
                    description: "Номер трека который надо удалить из очереди",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],
            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);
                const arg = args[0] ? parseInt(args[0]) : 1;

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если аргумент не число
                else if (isNaN(arg)) return { content: `${author}, Это не число!`, color: "Yellow" };

                //Если аргумент больше кол-ва треков
                else if (arg > queue.songs.length && arg < queue.songs.length) return { content: `${author}, Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, color: "Yellow" };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                let {title} = queue.songs[arg - 1];

                if (arg === 1) {
                    if (queue.repeat !== "off") {
                        queue.songs.splice(0, 1); //Удаляем первый трек
                        queue.player.stop();
                    } else queue.player.stop();
                } else queue.songs.splice(arg - 1, 1); //Удаляем трек указанный пользователем

                //Сообщаем какой трек был убран
                return { content: `⏭️ | Remove song | ${title}`, codeBlock: "css", color: "Green" };
            }
        })
    };
}

export default Object.values({Command_Skip, Command_Remove});