"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
const CollectorArraySort_1 = require("../../Core/Utils/CollectorArraySort");
const FullTimeSongs_1 = require("../../Modules/Music/src/Manager/Functions/FullTimeSongs");
class CommandQueue extends Constructor_1.Command {
    constructor() {
        super({
            name: "queue",
            aliases: ["queue", "list", "musiclist"],
            description: "Плейлист сервера",
            enable: true
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            let pages = [], page = 1, num = 1, newSongs = queue.songs.ArraySort(10);
            newSongs.forEach((s) => {
                let i = s.map((video) => (`[${num++}]  [${video.duration.StringTime}] [${message.client.ConvertedText(video.title, 80, true).replace(/[\s",']/g, ' ')}]`)).join(`\n`);
                if (i !== undefined)
                    pages.push(i);
            });
            return new CollectorArraySort_1.CollectorSortReaction()._run(`\`\`\`css\n➡️ | Current playing [${queue.songs[0].title}]\n\n${pages[page - 1]}\n\n${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}\`\`\``, pages, page, message, true);
        };
    }
    ;
}
exports.default = CommandQueue;
