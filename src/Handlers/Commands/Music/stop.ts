import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "stop",
            description: "Удаление музыкальной очереди!",

            execute: (message) => {
                const { author, guild, member } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member.voice?.channel || !member.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
                };

                db.queue.remove(queue.guild.id);
                return { content: `${author}, музыкальная очередь удалена!` };
            }
        });
    };
}