import {Command} from "../Constructor";
import {ClientMessage} from "../../Core/Client";
import {Queue} from "../../Core/Player/Structures/Queue/Queue";

export class CommandRandom extends Command {
    public constructor() {
        super({
            name: 'random',
            aliases: ["rm"],
            description: 'После каждой проигранной музыки будет выбрана случайная музыка!',

            enable: true,
            slash: true
        })
    };

    public run = (message: ClientMessage): void => {
        const queue: Queue = message.client.queue.get(message.guild.id);

        if (!queue) return message.client.Send({
            text: `${message.author}, ⚠ | Музыка щас не играет.`,
            message,
            color: "RED"
        });

        if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id) return message.client.Send({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`,
            message,
            color: "RED"
        });

        if (!message.member.voice.channel || !message.member.voice) return message.client.Send({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: "RED"
        });

        if (queue.songs.length <= 2) return message.client.Send({
            text: `${message.author}, Всего в списке ${queue.songs.length}, нет смысла!`,
            message,
            color: "RED"
        });

        if (queue.options.random === false) {
            queue.options.random = true;
            return message.client.Send({text: `🔀 | Auto shuffle enable`, message, type: "css"});
        } else {
            queue.options.random = false
            return message.client.Send({text: `🔀 | Auto shuffle disable`, message, type: "css"});
        }
    };
}