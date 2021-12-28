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
const discord_js_1 = require("discord.js");
const packageJson = __importStar(require("../../package.json"));
class CommandPackage extends Constructor_1.Command {
    constructor() {
        super({
            name: 'package',
            aliases: ['pack'],
            description: 'Все используемые пакеты',
            enable: true
        });
        this.run = async (message) => message.channel.send({ embeds: [this.CreateEmbed()] }).then(async (msg) => (this.DeleteMessage(msg, 25e3), this.DeleteMessage(message, 5e3))).catch((err) => console.log(`[Discord Error]: [Send message]: ${err}`));
        this.CreateEmbed = () => {
            let packages = {
                names: Object.keys(packageJson.dependencies),
                versions: Object.values(packageJson.dependencies)
            }, base = '';
            for (let i in packages.names)
                base += `• ${packages.names[i]}: ${packages.versions[i]}\n`;
            return new Embed(base);
        };
    }
    ;
}
exports.default = CommandPackage;
class Embed extends discord_js_1.MessageEmbed {
    constructor(base) {
        super({
            description: `\`\`\`css\n${base}\`\`\``,
            color: "YELLOW"
        });
    }
}
