import {Command, ResolveData} from "@Client/Command";
import {PlayerMessage} from "@AudioPlayer/Message";
import {ClientMessage} from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "channel",
            description: "Смена текстового канала для музыкальной очереди этого сервера!",
            cooldown: 20
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const voiceChannel = member?.voice?.channel;
        const queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!voiceChannel) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если текстовые каналы совпадают
        if (queue.message.channelId === message.channelId) return {text: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

        //Если возможно удалить текстовое сообщение, то удаляем
        if (queue.message.deletable) queue.message.delete().catch(() => undefined);

        queue.message = message;
        PlayerMessage.toPlay(queue);

        return {text: `${author}, смена текстового канал для ${guild} произведена`, color: "Green"}
    };
}