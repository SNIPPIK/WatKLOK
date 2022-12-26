import {Command, ResolveData} from "@Structures/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {Queue} from "@Queue/Queue";

export class Resume extends Command {
    public constructor() {
        super({
            name: "resume",
            aliases: [],
            description: "Возобновить воспроизведение текущего трека?!",

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

        //Если музыка уже играет
        if (queue.player.state.status === "read") return { text: `${author}, ⚠ Музыка щас играет.`, color: "DarkRed" };

        //Если текущий трек является потоковым
        if (queue.song.isLive) return { text: `${author}, ⚠ | Это бесполезно!`, color: "DarkRed" };

        return void client.player.resume(message);
    };
}