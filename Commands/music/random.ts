import {Command} from "../Constructor";
import {W_Message} from "../../Core/Utils/W_Message";

export default class CommandRandom extends Command {
    constructor() {
        super({
            name: 'randommusic',
            aliases: ["rm"],
            description: '[Beta] Рандомная музыка',

            enable: true
        })
    };

    public run = async (message: W_Message): Promise<void> => {
        this.DeleteMessage(message, 5e3);
        const queue = message.client.queue.get(message.guild.id);

        if (!queue) return message.client.Send({text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED'});

        if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id) return message.client.Send({text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED'});

        if (!message.member.voice.channel || !message.member.voice) return message.client.Send({text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED'});

        if (queue.songs.length <= 2) return message.client.Send({text: `${message.author}, Всего играет ${queue.songs.length} музыки, нет смысла!`, message: message, color: 'RED'});

        if (queue.options.random === false) {
            queue.options.random = true;
            return message.client.Send({text: `🔀 | Auto shuffle enable`, message: message, type: 'css'});
        } else {
            queue.options.random = false
            return message.client.Send({text: `🔀 | Auto shuffle disable`, message: message, type: 'css'});
        }
    };
}