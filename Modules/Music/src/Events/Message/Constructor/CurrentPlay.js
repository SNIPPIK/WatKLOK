"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentPlay = void 0;
const discord_js_1 = require("discord.js");
const FullTimeSongs_1 = require("../../../Manager/Functions/FullTimeSongs");
const Ver = 'https://cdn.discordapp.com/attachments/646399394517614622/858791356628205598/Untitled.png';
const NotVer = 'https://cdn.discordapp.com/attachments/646399394517614622/858791801494437898/Untitled2.png';
const NotFound = 'https://cdn.discordapp.com/attachments/860113484493881365/916587315378388992/UntitledNotFound.png';
async function CurrentPlay(message, song, queue) {
    if (song.author.thumbnails.url === 'not')
        return new EmbedPlayNoAuthorImage(message, song, queue);
    return new EmbedPlay(message, song, queue);
}
exports.CurrentPlay = CurrentPlay;
class EmbedPlay extends discord_js_1.MessageEmbed {
    constructor(message, song, queue) {
        super({
            color: song.color,
            author: {
                name: message.client.ConvertedText(song.author.title, 45, false),
                icon_url: song.author.isVerified === undefined ? NotFound : song.author.isVerified ? Ver : NotVer,
                url: song.author.url,
            },
            thumbnail: {
                url: song.author.thumbnails.url,
            },
            fields: EmbedPlay.createFields(song, queue, message.client),
            image: {
                url: song.thumbnails.url
            },
            timestamp: new Date(),
            footer: {
                text: `${song.requester.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | 🎶: ${queue.songs.length}`,
                icon_url: song.requester.displayAvatarURL() ? song.requester.displayAvatarURL() : message.client.user.displayAvatarURL(),
            }
        });
    }
    ;
}
EmbedPlay.createFields = (song, queue, client) => {
    let fields = [{
            name: `Щас играет`,
            value: `**❯** [${client.ConvertedText(song.title, 29, true)}](${song.url})\n**❯** [${song.duration.StringTime}]`
        }];
    if (queue.options.loop === "song")
        fields.push({
            name: `Потом - [Повтор]`,
            value: `**❯** [${client.ConvertedText(queue.songs[0].title, 29, true)}](${queue.songs[0].url})`
        });
    else if (queue.songs[1])
        fields.push({
            name: `Потом`,
            value: `**❯** [${client.ConvertedText(queue.songs[1].title, 29, true)}](${queue.songs[1].url})`
        });
    return fields;
};
class EmbedPlayNoAuthorImage extends discord_js_1.MessageEmbed {
    constructor(message, song, queue) {
        super({
            color: song.color,
            author: {
                name: message.client.ConvertedText(song.author.title, 45, false),
                icon_url: song.author.isVerified === undefined ? NotFound : song.author.isVerified ? Ver : NotVer,
                url: song.author.url,
            },
            fields: EmbedPlay.createFields(song, queue, message.client),
            image: {
                url: song.thumbnails.url
            },
            timestamp: new Date(),
            footer: {
                text: `${song.requester.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | 🎶: ${queue.songs.length}`,
                icon_url: song.requester.displayAvatarURL() ? song.requester.displayAvatarURL() : message.client.user.displayAvatarURL(),
            }
        });
    }
    ;
}
