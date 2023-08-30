import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {Song} from "@AudioPlayer/Queue/Song";

export default class extends Command {
    public constructor() {
        super({
            name: "resume",
            description: "Возобновить воспроизведение текущего трека?!"
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если музыка уже играет
        if (queue.player.status === "read") return { text: `${author}, ⚠ | Музыка сейчас играет.`, color: "Yellow" };

        //Если текущий трек является потоковым
        if (queue.song.options.isLive) return { text: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

        const { title }: Song = queue.song;

        queue.player.resume;
        return { text: `▶️ | Resume song | ${title}`, codeBlock: "css", color: "Green" };
    };
}