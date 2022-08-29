import {Command} from "../../../Structures/Command";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {Voice} from "../../../AudioPlayer/Structures/Voice";
import {ClientMessage} from "../../Events/Activity/Message";

export default class Stop extends Command {
    public constructor() {
        super({
            name: "stop",
            aliases: ["leave", "disconnect", "discon"],
            description: "Завершаем воспроизведение музыки!",

            enable: true,
            slash: true
        });
    };

    public readonly run = (message: ClientMessage): void => {
        const queue: Queue = message.client.queue.get(message.guild.id);

        //Если есть очередь то
        if (queue) {
            Voice.Disconnect(message.guild.id);
            queue.songs = [];
            queue.cleanup(true);
            return;
        }

        try {
            Voice.Disconnect(message.guild.id);
            return message.client.sendMessage({text: `${message.author}, 👌`, message: message});
        } catch { //Если что-то пошло не так
            return message.client.sendMessage({text: `${message.author}, 🤔`, message: message});
        }
    };
}