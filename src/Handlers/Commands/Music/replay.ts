import {Song} from "@Client/Audio/Queue/Song";
import {Command} from "@Client";
import {db} from "@src";

export default class extends Command {
    public constructor() {
        super({
            name: "replay",
            description: "Повторить текущий трек?",

            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return { content: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };
                let { title }: Song = queue.songs.song;

                queue.player.play(queue.songs.song.resource);
                //Сообщаем о том что музыка начата с начала
                return { content: `🔂 | Replay | ${title}`, color: "Green", codeBlock: "css" };
            }
        });
    };
}