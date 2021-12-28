"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
class Send {
    constructor() {
        this.run = (client) => client.Send = (options) => typeof options.type === 'string' ? this.SendCode(options) : this.SendNotCode(options);
        this.SendCode = async (options) => this.Catch(options.message.channel.send({
            embeds: [new Embed(options.color, `\`\`\`${options.type}\n${options.text}\n\`\`\``)],
        }));
        this.SendNotCode = async (options) => this.Catch(options.message.channel.send({
            embeds: [new Embed(options.color, options.text)]
        }));
        this.Catch = async (type) => {
            type.then(async (msg) => setTimeout(() => msg.delete().catch((err) => console.log(`[Discord Error]: [Delete Message]: => ${err}`)), 12e3)).catch((err) => console.log(`[Discord Error]: [Send message]: ${err}`));
        };
        this.enable = true;
    }
    ;
}
exports.default = Send;
class Embed extends discord_js_1.MessageEmbed {
    constructor(color = '#03f0fc', text) {
        super({
            color: color,
            description: text
        });
    }
    ;
}
