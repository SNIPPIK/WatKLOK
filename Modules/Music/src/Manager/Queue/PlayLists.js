"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayList = void 0;
const discord_js_1 = require("discord.js");
const Song_1 = require("./Constructors/Song");
const FullTimeSongs_1 = require("../Functions/FullTimeSongs");
class PlayList {
    constructor() {
        this.pushItems = async (message, playlist, VoiceConnection) => {
            if (!playlist.items)
                return message.client.Send({ text: `${message.author}, Я не смог загрузить этот плейлист, Ошибка: Здесь больше 100 треков, youtube не позволит сделать мне столько запросов!`, message: message, color: "RED" });
            this.SendMessage(message, playlist).catch(async (err) => console.log(`[Discord Error]: [Send message]: ${err}`));
            return this.addSongsQueue(playlist.items, message, VoiceConnection);
        };
        this.SendMessage = async (message, playlist) => message.channel.send({ embeds: [new PlaylistEmbed(message, playlist, '#03fcdf')] }).then(async (msg) => setTimeout(() => msg.delete().catch(() => null), 15e3));
        this.addSongsQueue = async (playlistItems, message, VoiceConnection) => {
            let { queue, player } = message.client;
            return playlistItems.forEach((track) => setTimeout(async () => {
                if (!queue.get(message.guild.id))
                    return player.emit('play', message, VoiceConnection, track);
                return message.client.queue.get(message.guild.id).events.queue.emit('pushSong', new Song_1.Song(track, message), message);
            }, 2e3));
        };
    }
}
exports.PlayList = PlayList;
class PlaylistEmbed extends discord_js_1.MessageEmbed {
    constructor(message, { author, thumbnail, url, title, items }, color) {
        super({
            color: color,
            author: {
                name: author?.name || author?.title,
                icon_url: author?.thumbnails?.url || message.client.user.displayAvatarURL(),
                url: author?.url,
            },
            thumbnail: {
                url: !thumbnail?.url ? thumbnail : thumbnail?.url,
            },
            description: `Найден плейлист [${title}](${url})`,
            timestamp: new Date(),
            footer: {
                text: `${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(items)} | 🎶: ${items?.length}`,
                icon_url: message.author.displayAvatarURL({}),
            }
        });
    }
    ;
}
