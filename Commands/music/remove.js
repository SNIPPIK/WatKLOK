"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandRemove extends Constructor_1.Command {
    constructor() {
        super({
            name: "remove",
            aliases: [],
            description: 'Пропуск конкретной музыки',
            enable: true,
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (!args[0])
                args[0] = String(1);
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (isNaN(Number(args[0])))
                return message.client.Send({ text: `${message.author}, Это не число!`, message: message, color: 'RED' });
            if (parseInt(args[0]) > queue.songs.length)
                return message.client.Send({ text: `${message.author}, Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, message: message, color: 'RED' });
            return message.client.player.emit('remove', message, args);
        };
    }
    ;
}
exports.default = CommandRemove;
