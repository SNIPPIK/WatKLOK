import {Command} from "../Constructor";
import {ClientMessage} from "../../Core/Client";
import {Queue} from "../../Core/Player/Queue/Structures/Queue";

export class CommandSkip extends Command {
    public constructor() {
        super({
            name: "skip",
            aliases: ['s'],
            description: "Пропуск музыки",

            options: [{
                name: "value",
                description: "Skip before the song or skip current song",
                type: "STRING"
            }],
            enable: true,
            slash: true
        })
    };

    public run = async (message: ClientMessage, args: string[]): Promise<void | boolean> => {
        const queue: Queue = message.client.queue.get(message.guild.id);
        const argsNum = parseInt(args[0]);

        if (!queue) return message.client.Send({
            text: `${message.author}, ⚠ | Музыка щас не играет.`,
            message,
            color: 'RED'
        });

        if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id) return message.client.Send({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`,
            message,
            color: 'RED'
        });

        if (!message.member.voice.channel || !message.member.voice) return message.client.Send({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: 'RED'
        });

        try {
            return void message.client.player.emit('skip', message, args && args[0] && !isNaN(argsNum) ? argsNum : null);
        } catch {
            return message.client.Send({
                text: `${message.author}, Ошибка... попробуй еще раз!!!`,
                message,
                color: 'RED'
            });
        }
    };
}