import {Command, ResolveData} from "@Command";
import {ClientMessage} from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "configure-networking",
            description: "Если слишком много потерь пакетов!",
            cooldown: 10
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { client, guild } = message;
        const queue = client.queue.get(guild.id);

        if (!queue || !guild.members.me.voice) return {text: `${message.author}, я не нахожу ни очереди, ни голосового подключения!`, color: "DarkRed"};

        queue.player.pause;
        //Обновляем подключение
        queue.player.connection.configureNetworking();
        queue.player.resume;

        return {text: `${message.author}, голосовое подключение удалено и создано заново!`, color: "Green"};
    };
}