"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlAudioPlayer = void 0;
const ParserTimeSong_1 = require("../Manager/Functions/ParserTimeSong");
const StatusPlayerIsSkipped = new Set(['playing', 'paused', 'buffering']);
class ControlAudioPlayer {
    constructor() {
        this.resume = async (message) => new Promise(async (res) => {
            const { player, songs } = message.client.queue.get(message.guild.id);
            const { duration, title, color } = songs[0];
            if (player.state.status === 'paused') {
                player.unpause();
                return res(message.client.Send({ text: `▶️ | [${duration.StringTime}] | Resume song [${title}]`, message: message, type: 'css', color: color }));
            }
            return res(message.client.Send({ text: `${message.author}, Текущий статус плеера [${player.state.status}]!`, message: message, color: 'RED' }));
        });
        this.pause = async (message) => new Promise(async (res) => {
            const { player, songs } = message.client.queue.get(message.guild.id);
            const { duration, title, color } = songs[0];
            if (player.state.status === 'playing') {
                player.pause();
                return res(message.client.Send({ text: `⏸ | [${duration.StringTime}] | Pause song [${title}]`, message: message, type: 'css', color: color }));
            }
            return res(message.client.Send({ text: `${message.author}, Текущий статус плеера [${player.state.status}]!`, message: message, color: 'RED' }));
        });
        this.end = async (message) => new Promise(async (res) => {
            const { player } = message.client.queue.get(message.guild.id);
            if (StatusPlayerIsSkipped.has(player.state.status)) {
                player.stop();
                return res(player.unpause());
            }
            return res(null);
        });
        this.remove = async (message, args) => new Promise(async (res) => {
            const { player, songs, events } = message.client.queue.get(message.guild.id);
            const { requester, duration, title, url, color } = songs[args[0] - 1];
            const voiceConnection = message.client.connections(message.guild);
            const UserToVoice = !!voiceConnection.find((v) => v.id === songs[0].requester.id);
            if (songs.length <= 1)
                return player.stop();
            await (async () => events.message.emit('update', message));
            if (message.member.permissions.has('ADMINISTRATOR') || message.author.id === requester.id || !UserToVoice) {
                songs.splice(args[0] - 1, 1);
                if (parseInt(args[0]) === 1)
                    await this.end(message);
                return res(message.client.Send({ text: `⏭️ | [${duration.StringTime}] | Remove song [${title}]`, message: message, type: 'css', color: color }));
            }
            return res(message.client.Send({ text: `${message.author}, Ты не включал эту музыку [${title}](${url})`, message: message, color: 'RED' }));
        });
        this.seek = async (message, seek) => new Promise(async (res) => {
            const { player, songs } = message.client.queue.get(message.guild.id);
            const { title, color } = songs[0];
            try {
                await message.client.Send({ text: `⏭️ | Seeking to [${(0, ParserTimeSong_1.ParserTimeSong)(seek)}] song [${title}]`, message: message, type: 'css', color: color });
                return res(player.seek(message, seek));
            }
            catch (e) {
                message.client.console(e);
                return res(message.client.Send({ text: `${message.author}, Произошла ошибка... Попробуй еще раз!`, message: message, color: 'RED' }));
            }
        });
        this.skip = async (message, args) => new Promise(async (res) => {
            if (args)
                return res(this.skipTo(message, args));
            const { songs, player } = message.client.queue.get(message.guild.id);
            const { duration, title, url, color, requester } = songs[0];
            const voiceConnection = message.client.connections(message.guild);
            const UserToVoice = !!voiceConnection.find((v) => v.id === requester.id);
            if (message.member.permissions.has('ADMINISTRATOR') || message.author.id === requester.id || !UserToVoice) {
                if (player.state.status === 'buffering')
                    return res(message.client.Send({ text: `${message.author}, ⚠ Музыка еще не играет.`, message: message, color: 'RED' }));
                if (StatusPlayerIsSkipped.has(player.state.status)) {
                    await this.end(message);
                    return res(message.client.Send({ text: `⏭️ | [${duration.StringTime}] | Skip song [${title}]`, message: message, type: 'css', color: color }));
                }
            }
            return res(message.client.Send({ text: `${message.author}, Ты не включал эту музыку [${title}](${url})`, message: message, color: 'RED' }));
        });
        this.skipTo = async (message, args) => new Promise(async (res) => {
            const queue = message.client.queue.get(message.guild.id);
            const { duration, title, url, color, requester } = queue.songs[args[0] - 1];
            const voiceConnection = message.client.connections(message.guild);
            const UserToVoice = !!voiceConnection.find((v) => v.id === queue.songs[0].requester.id);
            if (args[0] > queue.songs.length)
                throw res(message.client.Send({ text: `${message.author}, В очереди ${queue.songs.length}!`, message: message, color: 'RED' }));
            if (message.member.permissions.has('ADMINISTRATOR') || message.author.id === requester.id || !UserToVoice) {
                if (queue.options.loop === "songs")
                    for (let i = 0; i < args[0] - 2; i++)
                        queue.songs.push(queue.songs.shift());
                else
                    queue.songs = queue.songs.slice(args[0] - 2);
                await this.end(message);
                return res(message.client.Send({ text: `⏭️ | [${duration.StringTime}] | Skip to song [${args[0]}]  [${title}]`, message: message, type: 'css', color: color }));
            }
            return res(message.client.Send({ text: `${message.author}, Ты не включал эту музыку [${title}](${url})`, message: message, color: 'RED' }));
        });
        this.replay = async (message) => new Promise(async (res) => {
            const { player, songs } = message.client.queue.get(message.guild.id);
            const { title, color, duration } = songs[0];
            try {
                await message.client.Send({ text: `🔂 | [${duration.StringTime}] | Replay [${title}]`, message: message, color: color, type: "css" });
                return res(player.seek(message, 0));
            }
            catch (e) {
                message.client.console(e);
                return res(message.client.Send({ text: `${message.author}, Произошла ошибка... Попробуй еще раз!`, message: message, color: 'RED' }));
            }
        });
        this.bass = async (message, args) => new Promise(async (res) => {
            const { options, player } = message.client.queue.get(message.guild.id);
            const seek = parseInt((player.state.resource.playbackDuration / 1000).toFixed(0));
            options.bass = args >= 10 ? 10 : !args ? 0 : args;
            try {
                if (options.bass && !args) {
                    await message.client.Send({ text: `#️⃣ | Bass boost: выключен`, message: message, type: "css" });
                }
                else {
                    await message.client.Send({ text: `#️⃣ | Bass boost: ${options.bass}`, message: message, type: "css" });
                }
                return res(player.seek(message, seek));
            }
            catch (e) {
                message.client.console(e);
                return res(message.client.Send({ text: `${message.author}, Произошла ошибка... Попробуй еще раз!`, message: message, color: "RED" }));
            }
        });
        this.speed = async (message, args) => new Promise(async (res) => {
            const { player, options } = message.client.queue.get(message.guild.id);
            const seek = parseInt((player.state.resource.playbackDuration / 1000).toFixed(0));
            options.speed = args >= 3 ? 3 : !args ? 1 : args;
            try {
                if (options.speed && !args) {
                    await message.client.Send({ text: `⏭ | Speed player: 1`, message: message, type: "css", color: "GREEN" });
                }
                else {
                    await message.client.Send({ text: `⏭ | Speed player: ${options.speed}`, message: message, type: "css", color: "GREEN" });
                }
                return res(player.seek(message, seek));
            }
            catch (e) {
                message.client.console(e);
                return res(message.client.Send({ text: `${message.author}, Произошла ошибка... Попробуй еще раз!`, message: message, color: "RED" }));
            }
        });
    }
}
exports.ControlAudioPlayer = ControlAudioPlayer;
