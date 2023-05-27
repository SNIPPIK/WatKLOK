import { Command, ResolveData } from "@Client/Command";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";

export class ReplayCommand extends Command {
    public constructor() {
        super({
            name: "replay",
            aliases: ['repl'],
            description: "Повторить текущий трек?",

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        return void client.player.replay(message);
    };
}