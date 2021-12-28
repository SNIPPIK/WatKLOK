"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const Constructor_1 = require("../Constructor");
class CommandEval extends Constructor_1.Command {
    constructor() {
        super({
            name: 'eval',
            enable: true,
            isOwner: true,
            slash: false
        });
        this.run = async (message, args) => {
            let code = args.join(" "), queue = message.client.queue.get(message.guild.id), voiceChannel = message.member.voice.channel, StartTime = new Date().getMilliseconds(), evaled;
            try {
                evaled = eval(code);
                return this.MessageSend(message, evaled, 'GREEN', '[Status: Work]', code, StartTime);
            }
            catch (err) {
                this.MessageSend(message, err.code ? err.code : err, 'RED', '[Status: Fail]', code, StartTime);
                return message.client.console(`[EVAL]: [ERROR: ${err.code ? err.code : err}]`);
            }
        };
        this.MessageSend = (message, response, color, type, code, StartTime) => {
            let embed = new discord_js_1.MessageEmbed()
                .setTitle(`${type === 'Fail' ? `❌ ${type}` : `✅ ${type}`}\n`)
                .setColor(color)
                .addField("Input Code:", `\`\`\`js\n${code}\n\`\`\``, false)
                .addField("Output Code:", `\`\`\`js\n${response}\`\`\``, false);
            let EndTime = new Date().getMilliseconds();
            embed.setFooter(`Time: ${EndTime - StartTime} ms`);
            return message.channel.send({ embeds: [embed] }).then(async (msg) => {
                setTimeout(async () => msg.delete().catch(() => null), 10000);
            });
        };
    }
    ;
}
exports.default = CommandEval;
