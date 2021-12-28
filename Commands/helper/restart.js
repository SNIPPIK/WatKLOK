"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandRestart extends Constructor_1.Command {
    constructor() {
        super({
            name: 'restart',
            aliases: ["res"],
            description: 'Перезапуск плеера, очередь этого сервера будет потеряна',
            enable: true,
            slash: false
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (!queue)
                return message.client.Send({ text: `${message.author}, ⚠ | Музыка щас не играет.`, message: message, color: 'RED' });
            return message.channel.send({ embeds: [{ description: "**Очередь и плеер будут уничтожены!** \n**Музыка перезапустится только для этого сервера!**", color: "RED" }] }).then(async (msg) => (await this.createReaction(message, msg, queue, "✅", () => (this.DeleteMessage(msg, 5e3), queue.events.queue.emit('DestroyQueue', queue, message))),
                await this.createReaction(message, msg, queue, "❎", () => this.DeleteMessage(msg, 5e3))));
        };
        this.createReaction = (message, msg, queue, emoji, callback) => msg.react(emoji).then(async () => msg.createReactionCollector({ filter: async (reaction, user) => (reaction.emoji.name === emoji && user.id !== msg.client.user.id) }).on('collect', async () => callback()));
    }
    ;
}
exports.default = CommandRestart;
