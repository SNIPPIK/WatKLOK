"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Queue = void 0;
const node_events_1 = require("node:events");
const Msg_1 = require("../../../Events/Message/Msg");
const AudioPlayer_1 = require("../../../AudioPlayer/AudioPlayer");
const VoiceDestroyer_1 = require("../../../Events/Voice/VoiceDestroyer");
const Voice_1 = require("../../Voice/Voice");
class Queue {
    constructor(message, VoiceConnection) {
        this.player = new AudioPlayer_1.audioPlayer(message);
        this.events = {
            message: new Msg_1.EventMessage(),
            queue: new QueueEvents(),
            helper: new VoiceDestroyer_1.VoiceEvents()
        };
        this.channels = {
            message: message,
            voice: VoiceConnection,
            connection: null
        };
        this.options = {
            random: false,
            loop: "off",
            stop: false,
            bass: 0,
            speed: 0
        };
        this.AutoDisconnect = {
            state: null,
            timer: null
        };
        this.songs = [];
    }
    ;
}
exports.Queue = Queue;
class QueueEvents extends node_events_1.EventEmitter {
    constructor() {
        super();
        this.onPushSong = async (song, message) => new Promise(async (res) => {
            let queue = message.client.queue.get(message.guild.id);
            return res(queue ? queue.songs.push(song) : null);
        });
        this.onDestroyQueue = async (queue, message, sendDelQueue = true) => new Promise(async (res) => {
            if (!queue)
                return;
            await this.DeleteMessage(queue);
            await this.LeaveVoice(queue?.channels?.message?.guild.id);
            await this.DestroyEvents(queue);
            await this.StopPlayer(queue.player);
            if (sendDelQueue)
                await this.SendChannelToEnd(queue, message);
            return res(this.DeleteQueue(message));
        });
        this.StopPlayer = async (player) => player ? player.stop() : null;
        this.LeaveVoice = async (GuildID) => new Voice_1.VoiceManager().Disconnect(GuildID);
        this.DeleteMessage = async ({ channels }) => setTimeout(async () => channels?.message?.delete().catch(() => undefined), 3e3);
        this.SendChannelToEnd = async ({ options }, message) => {
            if (options.stop)
                return message.client.Send({ text: `🎵 | Музыка была выключена`, message: message, type: 'css' });
            return message.client.Send({ text: `🎵 | Музыка закончилась`, message: message, type: 'css' });
        };
        this.DeleteQueue = async (message) => setTimeout(async () => {
            message.client.console(`[GuildQueue]: [Delete]: [${message.guild.id}]`);
            return message.client.queue.delete(message.guild.id);
        }, 75);
        this.DestroyEvents = async ({ events, player }) => {
            ["idle", "error", "buffering"].forEach((eventName) => player.removeAllListeners(eventName));
            ["update", "playSong", "warning", "push"].forEach((eventName) => events.message.removeAllListeners(eventName));
            ["StartTimerDestroyer", "CancelTimerDestroyer"].forEach((eventName) => events.helper.removeAllListeners(eventName));
            ["DestroyQueue", "pushSong"].forEach((eventName) => this.removeAllListeners(eventName));
            return null;
        };
        this.on('DestroyQueue', this.onDestroyQueue);
        this.on('pushSong', this.onPushSong);
        this.setMaxListeners(2);
    }
    ;
}
