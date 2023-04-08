import { Command, ResolveData } from "@Structures/Handlers";
import { Queue } from "@AudioPlayer/Structures/Queue";
import { ClientMessage } from "@Client/Message";

export class StopCommand extends Command {
    public constructor() {
        super({
            name: "stop",
            aliases: ["end"],
            description: "Удаление музыкальной очереди!",

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, guild, member, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member.voice?.channel || !member.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        queue.cleanup();
        return { text: `${author}, музыкальная очередь удалена!` };
    };
}