"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const Buttons = {
    MyUrl: new discord_js_1.MessageButton().setURL('https://discord.com/oauth2/authorize?client_id=777195112576450580&permissions=8&scope=bot+applications.commands').setEmoji('🔗').setStyle('LINK').setLabel('Invite'),
    ServerUrl: new discord_js_1.MessageButton().setURL('https://discord.gg/qMf2Sv3').setEmoji('🛡').setStyle('LINK').setLabel('Help server'),
    MyWebSite: new discord_js_1.MessageButton().setURL('https://watklok.herokuapp.com').setEmoji('🌐').setStyle('LINK').setLabel('Web site')
};
const RunButt = new discord_js_1.MessageActionRow().addComponents(Buttons.MyUrl, Buttons.ServerUrl, Buttons.MyWebSite);
class guildCreate {
    constructor() {
        this.run = async (guild) => guild.systemChannel ? guild.systemChannel.send({ embeds: [new ConstructEmbed(guild)], components: [RunButt] }).then(async (msg) => setTimeout(async () => msg.delete().catch(async (err) => console.log(`[Discord Message]: [guildCreate]: [Delete]: ${err}`)), 60e3)).catch(async (e) => console.log(`[Discord event]: [guildCreate]: ${e}`)) : null;
        this.name = 'guildCreate';
        this.enable = true;
    }
}
exports.default = guildCreate;
class ConstructEmbed extends discord_js_1.MessageEmbed {
    constructor(guild) {
        super({
            color: "GREEN",
            author: {
                name: guild.name,
                icon_url: guild.iconURL({ size: 512 })
            },
            description: `**Спасибо что добавили меня 😉**\nМоя основная задача музыка, официальные платформы которые я поддерживаю (YouTube, Spotify, SoundCloud)\nПоддержка других языков дорабатывается.\nЯ полностью бесплатный, хост тоже бесплатный)\nНасчет ошибок и багов писать на сервер поддержки.\nДанное сообщение будет удалено через 1 мин.`,
            thumbnail: { url: guild.bannerURL({ size: 4096 }) },
            timestamp: new Date()
        });
    }
}
