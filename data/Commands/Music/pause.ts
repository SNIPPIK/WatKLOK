import { Command, ResolveData } from "@Client/Command";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";

export class PauseCommand extends Command {
    public constructor() {
        super({
            name: "pause",
            description: "Приостановить воспроизведение текущего трека?!",

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Включен режим радио!`, color: "Yellow" };

        //Если музыка уже приостановлена
        if (queue.player.state.status === "pause") return { text: `${author}, ⚠ | Музыка уже приостановлена!`, color: "Yellow" };

        //Если текущий трек является потоковым
        if (queue.song.options.isLive) return { text: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

        return void client.player.pause(message);
    };
}