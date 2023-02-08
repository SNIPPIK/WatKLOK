import {Command, ResolveData} from "@Structures/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {Queue} from "@Queue/Queue";

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
        const {author, member, guild, client} = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "DarkRed"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Включен режим радио!`, color: "DarkRed" };

        //Если музыка уже приостановлена
        if (queue.player.state.status === "pause") return { text: `${author}, ⚠ | Музыка уже приостановлена!`, color: "DarkRed" };

        //Если текущий трек является потоковым
        if (queue.song.isLive) return { text: `${author}, ⚠ | Это бесполезно!`, color: "DarkRed" };

        return void client.player.pause(message);
    };
}