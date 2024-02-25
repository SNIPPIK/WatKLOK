import {Assign, Command} from "@handler";
import {Voice} from "@watklok/voice";
import {db} from "@Client/db";

export default class extends Assign<Command> {
    public constructor() {
        super({
            name: "leave",
            description: "Отключение от голосового канала!",
            execute: (message) => {
                const { guild, member, author } = message;
                const queue = db.queue.get(guild.id);
                const voiceConnection = Voice.get(guild.id);

                //Если бот не подключен к голосовому каналу
                if (!voiceConnection) return { content: `${author}, я не подключен к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
                };

                voiceConnection.disconnect();
                if (queue) return { content: `${author}, отключение от голосового канала! Очередь будет удалена!` };

                return { content: `${author}, отключение от голосового канала!` };
            }
        });
    };
}