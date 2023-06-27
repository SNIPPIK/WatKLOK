import {Command, ResolveData} from "@Client/Command";
import {ClientMessage} from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "configure-networking",
            aliases: ["fixvoice"],
            description: "Если слишком много потерь пакетов!",
            cooldown: 10
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { client, guild } = message;
        const queue = client.player.queue.get(guild.id);

        if (!queue || !guild.members.me.voice) return {text: `${message.author}, я не нахожу ни очереди, ни голосового подключения!`, color: "DarkRed"};

        queue.player.pause;
        //Обновляем подключение
        queue.player.connection.configureNetworking();
        queue.player.resume;

        return {text: `${message.author}, голосовое подключение удалено и создано заново!`, color: "Green"};
    };
}