"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandSeek extends Constructor_1.Command {
    constructor() {
        super({
            name: "seek",
            aliases: ['begin', 'sek', 'beg'],
            description: "Пропуск времени в музыке",
            enable: true,
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id), choiceDur = args.join(" ").split(":");
            let optDur;
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (queue.songs[0].isLive)
                return message.client.Send({ text: `${message.author}, А как?`, message: message, color: 'RED' });
            if (args.join(' ').match(':')) {
                if (!args.join(" ").match(':'))
                    return message.client.Send({ text: `${message.author}, Укажи время!!!\nПример 00:00:00`, message: message, color: 'RED' });
                if (!choiceDur[2])
                    optDur = (choiceDur[0] * 60) + (choiceDur[1] % 60000);
                else
                    optDur = (choiceDur[0] * 60 * 60) + (choiceDur[1] * 60) + (choiceDur[2] % 60000);
            }
            else
                optDur = parseInt(args[0]);
            if (isNaN(optDur))
                return message.client.Send({ text: `${message.author}, Я не могу определить что ты написал, попробуй еще раз!`, message: message, color: 'RED' });
            if (optDur > queue.songs[0].duration.seconds)
                return message.client.Send({ text: `${message.author}, Ты указал слишком много времени!`, message: message, color: 'RED' });
            return message.client.player.emit('seek', message, optDur);
        };
    }
    ;
}
exports.default = CommandSeek;
