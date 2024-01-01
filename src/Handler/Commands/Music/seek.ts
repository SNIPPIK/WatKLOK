import { ApplicationCommandOptionType } from "discord.js";
import {Duration} from "@Client/Audio";
import { Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "seek",
            description: "Пропуск времени в текущем треке!",

            usage: "00:20 | 20",
            options: [{
                name: "value",
                description: "Пример - 00:00",
                required: true,
                type: ApplicationCommandOptionType["String"]
            }],

            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return {
                    content: `${author}, Необходимо подключится к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.options.isLive) return { content: `${author}, А как? Это же стрим!`, color: "Yellow" };

                //Если пользователь не указал время
                else if (!args[0]) return { content: `${author}, Укажи время, пример 00:00:00!`, color: "Yellow" };

                const duration = Duration.parseDurationString(args[0]);

                //Если пользователь написал что-то не так
                if (isNaN(duration)) return { content: `${author}, Я не могу определить что ты написал, попробуй еще раз!`, color: "Yellow" };

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.songs.song.duration.seconds) return { content: `${author}, Ты указал слишком много времени!`, color: "Yellow" };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.hasSkipped) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(queue.songs.song.resource, !queue.songs.song.options.isLive, duration);

                //Отправляем сообщение о пропуске времени
                return { content: `⏭️ | Seeking to [${args[0]}] song\n> ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}