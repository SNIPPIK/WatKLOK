"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
const os = __importStar(require("node:os"));
const discord_js_1 = require("discord.js");
const pak = __importStar(require("../../package.json"));
const ParserTimeSong_1 = require("../../Modules/Music/src/Manager/Functions/ParserTimeSong");
const core = os.cpus()[0];
class CommandInfo extends Constructor_1.Command {
    constructor() {
        super({
            name: 'info',
            aliases: ['information'],
            enable: true
        });
        this.run = async (message) => {
            const Buttons = {
                MyUrl: new discord_js_1.MessageButton().setURL(`https://discord.com/oauth2/authorize?client_id=${message.client.user.id}&permissions=8&scope=bot+applications.commands`).setEmoji('🔗').setStyle('LINK').setLabel('Invite'),
                ServerUrl: new discord_js_1.MessageButton().setURL('https://discord.gg/qMf2Sv3').setEmoji('🛡').setStyle('LINK').setLabel('My server')
            };
            const RunButt = new discord_js_1.MessageActionRow().addComponents(Buttons.MyUrl, Buttons.ServerUrl);
            return message.channel.send({ embeds: [new InfoEmbed(message)], components: [RunButt] }).then(async (msg) => (this.DeleteMessage(msg, 35e3), this.DeleteMessage(message, 5e3))).catch((err) => console.log(`[Discord Error]: [Send message]: ${err}`));
        };
    }
    ;
}
exports.default = CommandInfo;
function FormatBytes(heapUsed) {
    if (heapUsed === 0)
        return '0 Байт';
    const sizes = ['Байт', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ', 'ЕБ', 'ЗБ', 'УБ'];
    const i = Math.floor(Math.log(heapUsed) / Math.log(1024));
    return `${parseFloat((heapUsed / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}
class InfoEmbed extends discord_js_1.MessageEmbed {
    constructor(message) {
        super({
            color: "GREEN",
            thumbnail: {
                url: message.client.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })
            },
            author: {
                name: 'Информация',
                icon_url: message.client.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
            },
            fields: [
                {
                    name: `Основные`,
                    value: `**❯ Команд:** ${message.client.commands.size}\n**❯ Version:** [${pak.version}]\n**❯ Процессор [${core?.model}]**`
                },
                {
                    name: 'Статистика',
                    value: `\`\`\`css\n• Uptime     => ${(0, ParserTimeSong_1.ParserTimeSong)(message.client.uptime / 1000)}\n• Memory     => ${FormatBytes(process.memoryUsage().heapUsed)}\n• Platform   => ${process.platform}\n• Node       => ${process.version}\n\n• Servers    => ${message.client.guilds.cache.size}\n• Channels   => ${message.client.channels.cache.size}\n\`\`\`\n`
                },
                {
                    name: 'Код написан на',
                    value: `\`\`\`css\nTypeScript: 81.3%\nJavaScript: 18.7%\`\`\``
                },
                {
                    name: 'Музыка',
                    value: `\`\`\`css\n• Queue      => ${message.client.queue.size}\n• Player     => ${message.client.queue.get(message.guild.id) ? message.client.queue.get(message.guild.id).player.state.status : 'Is not a work player'}\`\`\``
                }
            ],
            timestamp: new Date(),
            footer: {
                text: `Ping - ${Date.now() - message.createdTimestamp < 0 ? 5 : Date.now() - message.createdTimestamp} | Api - ${Math.round(message.client.ws.ping < 0 ? 5 : message.client.ws.ping)}`,
            }
        });
    }
    ;
}
