import toPlay from "@handler/Player/Messages/toPlay";
import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "channel",
            description: "Смена текстового канала для музыкальной очереди этого сервера!",

            execute: (message) => {
                const { author, member, guild } = message;
                const voiceChannel = member?.voice?.channel;
                const queue = db.music.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!voiceChannel) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текстовые каналы совпадают
                else if (queue.message.channelId === message.channelId) return {content: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                //Если возможно удалить текстовое сообщение, то удаляем
                else if (queue.message.deletable) queue.message.delete().catch((): any => undefined);

                queue.message = message as any;
                toPlay(queue);

                return {content: `${author}, смена текстового канал для ${guild} произведена`, color: "Green"}
            }
        });
    };
}