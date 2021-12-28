"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandBass extends Constructor_1.Command {
    constructor() {
        super({
            name: 'bass',
            aliases: ['bass-boost', 'bb'],
            description: 'Повышение громкости баса',
            enable: true,
            slash: true,
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (isNaN(parseInt(args.join(" "))))
                return message.client.Send({ text: `${message.author}, ⚠ | Укажи число на сколько будет увеличена громкость баса! Макс 10`, message: message, color: 'RED' });
            return message.client.player.emit("bass", message, parseInt(args.join(" ")));
        };
    }
    ;
}
exports.default = CommandBass;
