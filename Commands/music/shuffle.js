"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandShuffle extends Constructor_1.Command {
    constructor() {
        super({
            name: "shuffle",
            aliases: [],
            description: "Перетасовка музыки",
            enable: true,
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (!queue.songs)
                return message.client.Send({ text: `${message.author}, Нет музыки в очереди!`, message: message, color: 'RED' });
            if (queue.songs.length < 3)
                return message.client.Send({ text: `${message.author}, Очень мало музыки, нужно более 3`, message: message, color: 'RED' });
            this.shuffleSongs(queue.songs);
            return message.client.Send({ text: `🔀 | Shuffle total [${queue.songs.length}]`, message: message, type: 'css' });
        };
        this.shuffleSongs = (songs) => {
            for (let i = songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [songs[i], songs[j]] = [songs[j], songs[i]];
            }
        };
    }
    ;
}
exports.default = CommandShuffle;
