"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandSpeed extends Constructor_1.Command {
    constructor() {
        super({
            name: 'speed',
            aliases: [],
            description: 'Изменение скорости воспроизведения музыки',
            enable: true,
            slash: true,
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            if (Number(args.join(" ")) > 3 || Number(args.join(" ")) < 1)
                return message.client.Send({ text: `${message.author}, ⚠ | Укажи скорость воспроизведения музыки. Макс 3, мин 1`, message: message, color: 'RED' });
            return message.client.player.emit('speed', message, Number(args.join(" ")));
        };
    }
    ;
}
exports.default = CommandSpeed;
