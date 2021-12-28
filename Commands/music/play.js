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
const SPNK_1 = require("../../Core/SPNK");
const cfg = __importStar(require("../../db/Config.json"));
const youtubeStr = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
const spotifySrt = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
class CommandPlay extends Constructor_1.Command {
    constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з"],
            description: 'Воспроизведение плейлиста по URL или по названию музыки',
            permissions: { client: ['SPEAK', 'CONNECT'], user: [] },
            enable: true
        });
        this.run = async (message, args) => {
            this.DeleteMessage(message, 5e3);
            let voiceChannel = message.member.voice.channel, search = args.join(' '), queue = message.client.queue.get(message.guild.id);
            if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id)
                return message.client.Send({ text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`, message: message, color: 'RED' });
            if (!voiceChannel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (!search)
                return message.client.Send({ text: `${message.author}, Укажи ссылку, название!`, message: message, color: "RED" });
            await message.client.Send({ text: `🔎 Search: ${message.client.ConvertedText(search, 25)}`, message: message, color: "RANDOM", type: 'css' });
            return this.getInfoPlatform(search, message, voiceChannel).catch(async (e) => message.client.Send({ text: `${message.author}, Я нечего не нашел! Error: ${e}`, message: message, color: "RED" }));
        };
        this.getInfoPlatform = async (search, message, voiceChannel) => {
            if (search.match(youtubeStr))
                return this.PlayYouTube(message, search, voiceChannel);
            else if (search.match(spotifySrt))
                return this.PlaySpotify(message, search, voiceChannel);
            else if (search.match(/https/) && cfg.Player.Other.YouTubeDL)
                return new _YouTubeDl().getInfo(search, message, voiceChannel);
            return new _YouTube().SearchVideos(message, voiceChannel, search);
        };
        this.PlayYouTube = async (message, search, voiceChannel) => {
            if (search.match(/playlist/))
                return new _YouTube().getPlaylist(search, message, voiceChannel);
            return new _YouTube().getVideo(search, message, voiceChannel);
        };
        this.PlaySpotify = async (message, search, voiceChannel) => {
            if (search.match(/playlist/) || search.match(/album/))
                return new _Spotify().getPlaylist(search, message, voiceChannel);
            return new _Spotify().getTrack(search, message, voiceChannel);
        };
    }
    ;
}
exports.default = CommandPlay;
class _YouTube {
    constructor() {
        this.getVideo = async (search, message, voiceChannel) => this.error(new SPNK_1.YouTube().getVideo(search).then(async (video) => !video ? message.client.Send({ text: `${message.author}, Хм, YouTube не хочет делится данными! Существует ли это видео вообще!`, message: message, color: 'RED' }) : this.runPlayer(video, message, voiceChannel)), message);
        this.getPlaylist = async (search, message, voiceChannel) => this.error(new SPNK_1.YouTube().getPlaylist(search).then(async (playlist) => !playlist ? message.client.Send({ text: `${message.author}, Хм, YouTube не хочет делится данными! Существует ли это плейлист вообще!`, message: message, color: 'RED' }) : this.runPlaylistSystem(message, playlist, voiceChannel)), message);
        this.SearchVideos = async (message, voiceChannel, searchString) => this.SearchVideo(searchString).then(async (results) => this.SendMessage(message, results, voiceChannel, await this.ArraySort(results, message), results.length).catch((err) => console.log(err)));
        this.SearchVideo = async (searchString) => new SPNK_1.YouTube().searchVideos(searchString, { limit: 15 });
        this.ArraySort = async (results, message) => {
            let num = 1, resp;
            results.ArraySort(15).forEach((s) => resp = s.map((video) => (`${num++}:  [${video.duration === null ? 'Live' : video.duration}] [${message.client.ConvertedText(video.title, 80, true)}]`)).join(`\n`));
            return resp === undefined ? '😟 Похоже YouTube не хочет делится поиском, лечу бить ебало!' : resp;
        };
        this.SendMessage = async (message, results, voiceChannel, resp, num) => message.channel.send(`\`\`\`css\nВыбери от 1 до ${results.length}\n\n${resp}\`\`\``).then(async (msg) => {
            this.cancelReaction(msg, message).catch((err) => console.log(err));
            await this.MessageCollector(msg, message, num);
            return this.CreateCollector(msg, results, message, voiceChannel);
        });
        this.CreateCollector = async (msg, results, message, voiceChannel) => this.collector.on('collect', async (m) => {
            await this.deleteMessage(msg);
            await this.deleteMessage(m);
            this.collector.stop();
            return this.pushSong(results, m, message, voiceChannel);
        });
        this.pushSong = async (results, m, message, voiceChannel) => this.getVideo(results[parseInt(m.content) - 1].url, message, voiceChannel);
        this.deleteMessage = async (msg) => setTimeout(async () => msg.delete().catch(() => null), 1000);
        this.cancelReaction = async (msg, message) => msg.react('❌').then(async () => msg.createReactionCollector({ filter: async (reaction, user) => (reaction.emoji.name === '❌' && user.id !== message.client.user.id) }).on('collect', () => (this.collector?.stop(), this.deleteMessage(msg))));
        this.MessageCollector = async (msg, message, num) => this.collector = msg.channel.createMessageCollector({ filter: async (m) => !isNaN(m.content) && m.content <= num && m.content > 0 && m.author.id === message.author.id, max: 1 });
        this.error = async (i, message) => i.catch(async (err) => message.client.Send({ text: `${message.author}, YouTube: ${err.toString()}`, message: message, color: 'RED' }));
        this.runPlayer = async (video, message, voiceChannel) => (message.client.player.emit('play', message, voiceChannel, video));
        this.runPlaylistSystem = async (message, playlist, voiceChannel) => (message.client.player.emit('playlist', message, playlist, voiceChannel));
        this.collector = null;
    }
    ;
}
class _Spotify {
    constructor() {
        this.getTrack = async (search, message, voiceChannel) => this.error(new SPNK_1.Spotify().getTrack(search).then(async (video) => !video?.isValid ? message.client.Send({ text: `Хм, Spotify не хочет делится данными! Существует ли это трек вообще!`, message: message, color: 'RED' }) : this.runPlayer(video, message, voiceChannel)), message);
        this.getPlaylist = async (search, message, voiceChannel) => this.error(new SPNK_1.Spotify().getPlaylist(search).then(async (playlist) => !playlist?.title ? message.client.Send({ text: `${message.author}, Хм, Spotify не хочет делится данными! Существует ли это плейлист вообще!`, message: message, color: 'RED' }) : this.runPlaylistSystem(message, playlist, voiceChannel)), message);
        this.error = async (i, message) => i.catch(async (err) => message.client.Send({ text: `${message.author}, Spotify: ${err.toString()}`, message: message, color: 'RED' }));
        this.runPlayer = async (video, message, voiceChannel) => (message.client.player.emit('play', message, voiceChannel, video));
        this.runPlaylistSystem = async (message, playlist, voiceChannel) => (message.client.player.emit('playlist', message, playlist, voiceChannel));
    }
}
class _YouTubeDl {
    constructor() {
        this.getInfo = async (search, message, voiceChannel) => new SPNK_1.all().getTrack(search).then((i) => !i.isValid ? this.sendMessage(message) : this.pushSong(i, message, voiceChannel));
        this.pushSong = async (song, message, voiceChannel) => message.client.player.emit('play', message, voiceChannel, song);
        this.sendMessage = async (message) => message.client.Send({ text: `${message.author}, Я не смог получить данные с этой страницы!`, message: message, color: 'RED' });
    }
}
