import { Queue } from "@AudioPlayer/Queue/Queue";
import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";
import { Voice } from "@Util/Voice";

export default class extends Command {
    public constructor() {
        super({
            name: "leave",
            description: "Отключение от голосового канала!",
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { guild, member, author, client } = message;
        const queue: Queue = client.queue.get(guild.id);
        const actVoice = Voice.getVoice(guild.id);

        //Если бот не подключен к голосовому каналу
        if (!actVoice) return { text: `${author}, я не подключен к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
        };

        //Если включен режим радио
        if (queue && queue.options.radioMode) return { text: `${author}, я не могу отключится из-за включенного режима радио!` };

        Voice.disconnect(guild.id);
        if (queue) return { text: `${author}, отключение от голосового канала! Очередь будет удалена через **20 сек**!` };

        return { text: `${author}, отключение от голосового канала!` };
    };
}