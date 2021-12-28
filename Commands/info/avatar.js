"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
const discord_js_1 = require("discord.js");
class CommandAvatar extends Constructor_1.Command {
    constructor() {
        super({
            name: 'avatar',
            aliases: ["av", "avt"],
            description: 'Аватар пользователя',
            enable: true
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            let mentionedUser = await this.getUser(args, message);
            return this.SendMessage(message, mentionedUser).catch(async (err) => console.log(`[Discord Error]: [Send message]: ${err}`));
        };
        this.SendMessage = (message, mentionedUser) => message.channel.send({ embeds: [this.CreateEmbedMessage(mentionedUser, message)] }).then(async (msg) => setTimeout(() => { msg.delete().catch(async () => null); }, 2e4));
        this.CreateEmbedMessage = (mentionedUser, message) => {
            return new discord_js_1.MessageEmbed()
                .setImage(mentionedUser.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
                .setColor("RANDOM")
                .addField(`Пользователь`, `<@!${mentionedUser.id}>`)
                .setFooter(`${message.client.user.username}`, message.client.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
                .setTimestamp();
        };
        this.getUser = async (args, message) => {
            let User;
            if (args.join(' ').match('!'))
                User = (args[0] ? await message.client.users.fetch(args.join().split('<@!')[1].split('>')[0]) : await message.client.users.fetch(message.author.id));
            else if (!isNaN(Number(args[0])))
                User = await (message.client.users.fetch(args[0]));
            else
                User = (args[0] ? await message.client.users.fetch(args.join().split('<@')[1].split('>')[0]) : await message.client.users.fetch(message.author.id));
            return User ?? message.author;
        };
    }
    ;
}
exports.default = CommandAvatar;
