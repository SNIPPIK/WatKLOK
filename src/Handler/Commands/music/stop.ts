import {Command, messageUtils} from "../../../Structures/Handle/Command";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {ClientMessage} from "../../Events/Activity/interactiveCreate";

export class Stop extends Command {
    public constructor() {
        super({
            name: "stop",
            aliases: ["leave", "disconnect", "discon"],
            description: "Завершаем воспроизведение музыки!",

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): void => {
        const queue: Queue = message.client.queue.get(message.guild.id);

        //Если есть очередь то
        if (queue) queue.cleanup(true);

        try {
            return messageUtils.sendMessage({text: `${message.author}, 👌`, message: message});
        } catch { //Если что-то пошло не так
            return messageUtils.sendMessage({text: `${message.author}, 🤔`, message: message});
        }
    };
}