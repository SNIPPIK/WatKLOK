"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
class Message {
    constructor() {
        this.run = async (message) => {
            if (message.author.bot || message.channel.type === "DM")
                return;
            const prefix = message.client.cfg.Bot.prefix;
            const args = message.content.split(" ").slice(1);
            return this._getCommand(message, prefix, args);
        };
        this._getCommand = async (message, prefix, args) => {
            if (!message.content.startsWith(prefix))
                return;
            let cmd = message.content.slice(prefix.length).trim().split(/ +/g).shift().toLowerCase();
            let command = message.client.commands.get(cmd) || message.client.commands.get(message.client.aliases.get(cmd));
            return this._checkDataCommand(message, command, prefix, args);
        };
        this._checkDataCommand = async (message, command, prefix, args) => {
            let perm = await this._permissions(message, command).catch(() => false);
            if (await this._isOwner(message, command) || perm)
                return null;
            return this._runCommand(command, prefix, args, message);
        };
        this._runCommand = async (command, prefix, args, message) => {
            if (command)
                return command.run(message, args);
            return message.client.Send({ text: `${message.author}, Я не нахожу такой команды, используй ${prefix}help  :confused:`, message: message, color: 'RED' });
        };
        this._isOwner = async (message, { isOwner }) => isOwner && message.author.id !== '312909267327778818' ? message.client.Send({ text: `${message.author}, Эта команда не для тебя!`, message: message, color: 'RED' }) : false;
        this._permissions = async (message, { permissions }) => permissions?.user ? this._permUser(permissions.user, message) : permissions?.client ? this._permClient(permissions.client, message) : false;
        this._permUser = async (cmdPerm, message) => new UserPermissions().PermissionSize(cmdPerm, message);
        this._permClient = async (cmdPerm, message) => new ClientPermissions().PermissionSize(cmdPerm, message);
        this.name = "messageCreate";
        this.enable = true;
    }
    ;
}
exports.default = Message;
class ClientPermissions {
    constructor() {
        this.PermissionSize = async (cmdPerm, message) => {
            if (cmdPerm.length > 1)
                return this._createPresencePerm(cmdPerm, message);
            return this._createPresenceOnePerm(cmdPerm, message);
        };
        this._createPresenceOnePerm = async (cmdPerm, message) => !message.guild.me.permissions.has(cmdPerm[0]) ? this.SendMessage(new NotPermissions(message, `У меня нет таких прав!`, `•${cmdPerm[0]}`), message) : false;
        this._createPresencePerm = async (cmdPerm, message) => {
            let resp = await this._parsePermissions(cmdPerm, message);
            if (resp !== '')
                return this.SendMessage(new NotPermissions(message, `У меня нет таких прав!`, resp), message);
            return false;
        };
        this._parsePermissions = async (cmdPerm, message, resp = '') => {
            for (let i in cmdPerm) {
                if (!message.guild?.me?.permissions?.has(cmdPerm[i]))
                    resp += `•${cmdPerm[i]}\n`;
            }
            return resp;
        };
        this.SendMessage = async (embed, message) => this.DeleteMessage(message.channel.send({ embeds: [embed] }));
        this.DeleteMessage = async (send) => this.ErrorMessage(send.then(async (msg) => setTimeout(async () => msg.delete().catch(() => null)), 12000));
        this.ErrorMessage = async (send) => send.catch(() => null);
    }
}
class UserPermissions {
    constructor() {
        this.PermissionSize = async (cmdPerm, message) => {
            if (cmdPerm.length > 1)
                return this._createPresencePerm(cmdPerm, message);
            return this.CreatePresenceOnePerm(cmdPerm, message);
        };
        this._createPresencePerm = async (cmdPerm, message) => {
            let resp = await this._parsePermissions(cmdPerm, message);
            if (resp !== '')
                return this.SendMessage(new NotPermissions(message, `У тебя нет таких прав!`, resp), message);
            return false;
        };
        this.CreatePresenceOnePerm = async (cmdPerm, message) => !message.member.permissions.has(cmdPerm[0]) ? this.SendMessage(new NotPermissions(message, `У тебя нет таких прав!`, `•${cmdPerm[0]}`), message) : false;
        this._parsePermissions = async (cmdPerm, message, resp = '') => {
            for (let i in cmdPerm) {
                if (!message.member.permissions.has(cmdPerm[i]))
                    resp += `•${cmdPerm[i]}\n`;
            }
            return resp;
        };
        this.SendMessage = async (embed, message) => this.DeleteMessage(message.channel.send({ embeds: [embed] }));
        this.DeleteMessage = async (send) => this.ErrorMessage(send.then(async (msg) => setTimeout(async () => msg.delete().catch(() => null)), 12000));
        this.ErrorMessage = async (send) => send.catch(() => null);
    }
}
class NotPermissions extends discord_js_1.MessageEmbed {
    constructor(message, name, text) {
        super({
            color: "#03f0fc",
            author: { name: message.author.username, icon_url: message.author.displayAvatarURL({}) },
            thumbnail: { url: message.client.user.displayAvatarURL({}) },
            fields: [{ name: name, value: text }],
            timestamp: new Date()
        });
    }
    ;
}
