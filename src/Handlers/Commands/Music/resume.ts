import {Song} from "@Client/Audio/Queue/Song";
import {Command} from "@Client";
import {db} from "@src";

export default class extends Command {
    public constructor() {
        super({
            name: "resume",
            description: "Возобновить воспроизведение текущего трека?!",

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

                //Если музыка уже играет
                else if (queue.player.status === "playing") return { content: `${author}, ⚠ | Музыка сейчас играет.`, color: "Yellow" };

                //Если текущий трек является потоковым
                else if (queue.songs.song.options.isLive) return { content: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

                let { title }: Song = queue.songs.song;

                queue.player.resume();
                return { content: `▶️ | Resume song | ${title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}