"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddSong = void 0;
const discord_js_1 = require("discord.js");
const FullTimeSongs_1 = require("../../../Manager/Functions/FullTimeSongs");
const Ver = 'https://cdn.discordapp.com/attachments/646399394517614622/858791356628205598/Untitled.png';
const NotVer = 'https://cdn.discordapp.com/attachments/646399394517614622/858791801494437898/Untitled2.png';
const NotFound = 'https://cdn.discordapp.com/attachments/860113484493881365/916587315378388992/UntitledNotFound.png';
class AddSong extends discord_js_1.MessageEmbed {
    constructor(message, song, queue) {
        super({
            color: song.color,
            author: {
                name: message.client.ConvertedText(song.author.title, 45, false),
                icon_url: song.author.isVerified === undefined ? NotFound : song.author.isVerified ? Ver : NotVer,
                url: song.author.url,
            },
            thumbnail: {
                url: song.thumbnails.url,
            },
            fields: [{
                    name: `Добавлено`,
                    value: `**❯** [${message.client.ConvertedText(song.title, 40, true)}](${song.url}})\n**❯** [${song.duration.StringTime}]`
                }],
            timestamp: new Date(),
            footer: {
                text: `${song.requester.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | 🎶: ${queue.songs.length}`,
                icon_url: song.requester.displayAvatarURL(),
            }
        });
    }
    ;
}
exports.AddSong = AddSong;
