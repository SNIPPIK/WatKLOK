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
const cfg = __importStar(require("../../db/Config.json"));
const discord_js_1 = require("discord.js");
class Ready {
    constructor() {
        this.run = async (f1, f2, client) => {
            let channel = client.channels.cache.get(cfg.Channels.Start);
            if (channel)
                return channel.send({ embeds: [new Embed(client)] });
            return null;
        };
        this.name = "ready";
        this.enable = true;
    }
    ;
}
exports.default = Ready;
class Embed extends discord_js_1.MessageEmbed {
    constructor(client) {
        super({
            color: "WHITE",
            description: `**Heroku**: Restarting...`,
            timestamp: new Date(),
            footer: {
                text: `${client.user.username}`,
                icon_url: client.user.displayAvatarURL(),
            }
        });
    }
    ;
}
