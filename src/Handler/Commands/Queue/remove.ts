import { ApplicationCommandOptionType } from "discord.js";
import {Song} from "@Client/Audio/Queue/Song";
import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "remove",
            description: "Эта команда удаляет из очереди музыку!",

            usage: "1 | Можно убрать любой трек из очереди | Если аргумент не указан он будет равен 1",
            options: [
                {
                    name: "value",
                    description: "Номер трека который надо удалить из очереди",
                    required: true,
                    type: ApplicationCommandOptionType["String"]
                }
            ],

            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);
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
                else if (arg > queue.songs.length) return { content: `${author}, Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, color: "Yellow" };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.hasSkipped) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                let {title}: Song = queue.songs[arg - 1];

                if (arg === 1) {
                    if (queue.options.loop !== "off") {
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