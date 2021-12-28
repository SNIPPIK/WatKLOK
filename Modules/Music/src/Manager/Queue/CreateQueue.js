"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateQueue = void 0;
const Queue_1 = require("./Constructors/Queue");
const Song_1 = require("./Constructors/Song");
const Voice_1 = require("../Voice/Voice");
class CreateQueue {
    constructor() {
        this._ = async (message, VoiceChannel, track) => {
            let queue = message.client.queue.get(message.guild.id);
            let song = new Song_1.Song(track, message);
            return !queue ? this.ConstQueueGuild(message, VoiceChannel, song) : this.PushSong(message, song);
        };
        this.ConstQueueGuild = async (message, VoiceChannel, song) => {
            message.client.console(`[GuildQueue]: [Create]: [${message.guild.id}]`);
            message.client.queue.set(message.guild.id, new Queue_1.Queue(message, VoiceChannel));
            await this.PushSong(message, song, false);
            new Voice_1.VoiceManager().Join(VoiceChannel);
            return message.client.queue.get(message.guild.id).player.playStream(message);
        };
        this.PushSong = async (message, song, sendMessage = true) => {
            let { songs, events, channels } = message.client.queue.get(message.guild.id);
            songs.push(song);
            return setTimeout(async () => sendMessage ? events.message.emit("push", channels.message, song) : null, 230);
        };
    }
}
exports.CreateQueue = CreateQueue;
