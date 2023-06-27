import { Command, ResolveData } from "@Client/Command";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: 'random',
            aliases: ["rm"],
            description: 'После каждой проигранной музыки будет выбрана случайная музыка!'
        })
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        //Если всего 2 и менее треков
        if (queue.songs.length <= 2) return { text: `${author}, Всего в списке ${queue.songs.length}, нет смысла!`, color: "Yellow" };

        if (queue.options.random === false) {
            queue.options.random = true;
            return { text: `🔀 | Auto shuffle enable`, codeBlock: "css" };
        } else {
            queue.options.random = false
            return { text: `🔀 | Auto shuffle disable`, codeBlock: "css" };
        }
    };
}