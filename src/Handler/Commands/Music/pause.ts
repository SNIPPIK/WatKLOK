import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "pause",
            description: "Приостановить воспроизведение текущего трека?!",

            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если музыка уже приостановлена
                else if (queue.player.status === "pause") return { content: `${author}, ⚠ | Музыка уже приостановлена!`, color: "Yellow" };

                //Если текущий трек является потоковым
                else if (queue.songs.song.options.isLive) return { content: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

                //Приостанавливаем музыку если она играет
                queue.player.pause();
                return { content: `⏸ | Pause song | ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}