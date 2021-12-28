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
const discord_js_1 = require("discord.js");
const youtube_dl_1 = require("../../youtube-dl/youtube-dl");
const cfg = __importStar(require("../../db/Config.json"));
const SPNK_1 = require("../SPNK");
const FileSystem_1 = require("./FileSystem");
class WatKLOK_BOT extends discord_js_1.Client {
    constructor() {
        super({
            intents: (Object.keys(discord_js_1.Intents.FLAGS)),
            ws: {
                properties: {
                    $browser: "Web"
                }
            }
        });
        this.Login = () => {
            this.SettingsProject();
            this.login(cfg.Bot.token).then(() => {
                if (!this.shard)
                    this.ClientStatus();
                return (0, FileSystem_1.Load)(this);
            });
        };
        this.SettingsProject = () => {
            if (cfg.Bot.ignoreError)
                this.ProcessEvents().catch(async (err) => console.log(err));
            new SPNK_1.YouTube().setCookie(cfg.youtube.cookie);
            new SPNK_1.Spotify().Settings(cfg.spotify.clientID, cfg.spotify.clientSecret);
            (0, SPNK_1.setFFmpeg)(cfg.Player.Other.FFMPEG);
            if (cfg.Player.Other.YouTubeDL)
                new youtube_dl_1.YouTubeDL().download();
        };
        this.ClientStatus = () => this.user.setPresence({
            activities: [
                { name: `twitch.tv`, type: "STREAMING", url: "https://www.twitch.tv/faeervoo" }
            ],
            status: 'online',
            shardId: 0
        });
        this.ProcessEvents = async () => {
            process.on('uncaughtException', async (err) => {
                console.error(err);
                if (err.toString() === 'Error: connect ECONNREFUSED 127.0.0.1:443')
                    return null;
                try {
                    return this.channels.cache.get('906625710062444594').send(`${err.toString()}`);
                }
                catch (e) {
                    return null;
                }
            });
        };
        this.commands = new discord_js_1.Collection();
        this.aliases = new discord_js_1.Collection();
        this.queue = new discord_js_1.Collection();
        this.cfg = cfg;
    }
}
new WatKLOK_BOT().Login();
