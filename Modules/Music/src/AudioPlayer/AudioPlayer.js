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
exports.audioPlayer = void 0;
const voice_1 = require("@discordjs/voice");
const CreateStream_1 = require("./CreateStream");
const Voice_1 = require("../Manager/Voice/Voice");
const cfg = __importStar(require("../../../../db/Config.json"));
class audioPlayer extends voice_1.createAudioPlayer {
    constructor(msg) {
        super({ behaviors: { maxMissedFrames: cfg.Player.MaxSkipFragment || 0 } });
        this.seek = (message, seek) => new Promise((res) => {
            return res(this.CreateResource(message, seek).then((stream) => this.play(stream)));
        });
        this.playStream = (message) => new Promise((res) => {
            const queue = message.client.queue.get(message.guild.id);
            if (queue.songs?.length <= 0)
                return queue.events.queue.emit('DestroyQueue', queue, message);
            message.client.console(`[Playing: ${message.guild.id}]: [${queue.songs[0].type}]: [${queue.songs[0].title}]`);
            queue.events.message.emit('playSong', message);
            return res(this.CreateResource(message).then((stream) => this.play(stream)));
        });
        this.CreateResource = (message, seek = 0) => new Promise((res) => {
            const queue = message.client.queue.get(message.guild.id);
            return res(new CreateStream_1.CreateStream().init(queue.songs[0], queue, seek).then((stream) => (0, voice_1.createAudioResource)(stream, { inputType: voice_1.StreamType.Opus })));
        });
        this.onIdlePlayer = async (message) => new Promise(async (res) => {
            const queue = message.client.queue.get(message.guild.id);
            if (!queue || queue.songs.length <= 0)
                return;
            return res(this.playNextSong(message, queue));
        });
        this.onErrorPlayer = async (err, message) => new Promise(async (res) => {
            const { events, songs } = message.client.queue.get(message.guild.id);
            return res(events.message.emit('warning', message, songs[0], err));
        });
        this.onBufferingPlayer = async (message) => {
            const { channels, player } = message.client.queue.get(message.guild.id);
            if (!channels.connection?.subscribe)
                (channels.connection = new Voice_1.VoiceManager().Join(channels.voice)).subscribe(player);
            return null;
        };
        this.playNextSong = async (message, queue) => new Promise(async (res) => {
            if (this?.state?.missedFrames)
                await message.client.Send({ text: `[AudioPlayer]: Lost Frames [${this.state.missedFrames}]`, message: message, color: "GREEN" });
            this.isRemoveSong(queue);
            return res(queue.options.random === true ? this.Shuffle(message, queue) : this.playStream(message));
        });
        this.isRemoveSong = ({ options, songs }) => {
            if (options.loop === "song")
                return null;
            else if (options.loop === "songs") {
                let repeat = songs.shift();
                songs.push(repeat);
            }
            else
                songs.shift();
            return null;
        };
        this.Shuffle = async (message, { songs }) => {
            const set = Math.floor(Math.random() * songs.length);
            const LocalQueue2 = songs[set];
            songs[set] = songs[0];
            songs[0] = LocalQueue2;
            return this.playStream(message);
        };
        this.on("idle", async () => this.onIdlePlayer(msg));
        this.on("error", async (err) => this.onErrorPlayer(err, msg));
        this.on("buffering", async () => this.onBufferingPlayer(msg));
        this.setMaxListeners(3);
    }
    ;
}
exports.audioPlayer = audioPlayer;
