import {Command, messageUtils} from "../../../Structures/Handle/Command";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {ClientMessage} from "../../Events/Activity/interactiveCreate";

export default class Random extends Command {
    public constructor() {
        super({
            name: 'random',
            aliases: ["rm"],
            description: 'После каждой проигранной музыки будет выбрана случайная музыка!',

            isEnable: true,
            isSlash: true
        })
    };

    public readonly run = (message: ClientMessage): void => {
        const queue: Queue = message.client.queue.get(message.guild.id);

        //Если нет очереди
        if (!queue) return messageUtils.sendMessage({
            text: `${message.author}, ⚠ | Музыка щас не играет.`,
            message,
            color: "DarkRed"
        });

        //Если пользователь не подключен к голосовым каналам
        if (!message.member?.voice?.channel || !message.member?.voice) return messageUtils.sendMessage({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: "DarkRed"
        });

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && message.member?.voice?.channel?.id !== queue.voice.id) return messageUtils.sendMessage({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            message,
            color: "DarkRed"
        });

        //Если всего 2 и менее треков
        if (queue.songs.length <= 2) return messageUtils.sendMessage({
            text: `${message.author}, Всего в списке ${queue.songs.length}, нет смысла!`,
            message,
            color: "DarkRed"
        });

        if (queue.options.random === false) {
            queue.options.random = true;
            return messageUtils.sendMessage({text: `🔀 | Auto shuffle enable`, message, type: "css"});
        } else {
            queue.options.random = false
            return messageUtils.sendMessage({text: `🔀 | Auto shuffle disable`, message, type: "css"});
        }
    };
}