"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
const discord_js_1 = require("discord.js");
class CommandPing extends Constructor_1.Command {
    constructor() {
        super({
            name: "ping",
            description: "Проверка отклика сообщения",
            enable: true
        });
        this.run = async (message) => message.channel.send('Pinging...').then(async (m) => {
            this.DeleteMessage(message, 5e3);
            let embed = new discord_js_1.MessageEmbed()
                .setDescription(`Latency is **${Date.now() - message.createdTimestamp < 0 ? 2 : Date.now() - message.createdTimestamp}** ms\nAPI Latency is **${Math.round(message.client.ws.ping < 0 ? 2 : message.client.ws.ping)}** ms`)
                .setColor("RANDOM");
            m.edit({ embeds: [embed] }).then(async (msg) => this.DeleteMessage(msg, 12e3));
        }).catch(async (err) => console.log(`[Discord Error]: [Send message]: ${err}`));
    }
    ;
}
exports.default = CommandPing;
