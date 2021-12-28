"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const CollectorArraySort_1 = require("../../Core/Utils/CollectorArraySort");
const Constructor_1 = require("../Constructor");
class CommandHelp extends Constructor_1.Command {
    constructor() {
        super({
            name: 'help',
            aliases: ["h"],
            description: 'Все мои команды',
            enable: true
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const commands = message.client.commands, fakeCommands = [];
            commands.map((cmd) => !cmd.isOwner ? fakeCommands.push(cmd) : null);
            let List = fakeCommands.ArraySort(5);
            let data = this.CreateEmbedMessage(message, List);
            return new CollectorArraySort_1.CollectorSortReaction()._run(data.embed, data.pages, data.page, message, false);
        };
        this.CreateEmbedMessage = (message, List) => {
            let helpEmbed = new discord_js_1.MessageEmbed().setTitle("Help Menu").setColor("#0cff00").setThumbnail(message.client.user.avatarURL({ format: 'png', dynamic: true, size: 1024 })).setTimestamp();
            let pages = [], page = 1, i;
            List.forEach((s) => {
                i = s.map((cmd) => (`Команда [**${cmd.name}**]  
                    **❯ Сокращения:** ${cmd.aliases ? `(${cmd.aliases})` : `(Нет)`} 
                    **❯ Описание:** ${cmd.description ? `(${cmd.description})` : `(Нет)`}`)).join('\n\n');
                if (i !== undefined)
                    pages.push(i);
            });
            helpEmbed.setDescription(pages[page - 1]);
            helpEmbed.setFooter(`${message.author.username} | Лист 1 из ${pages.length}`, message.author.displayAvatarURL());
            return {
                embed: helpEmbed,
                pages: pages,
                page: page
            };
        };
    }
    ;
}
exports.default = CommandHelp;
