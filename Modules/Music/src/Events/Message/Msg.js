"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventMessage = void 0;
const events_1 = require("events");
const CurrentPlay_1 = require("./Constructor/CurrentPlay");
const Warning_1 = require("./Constructor/Warning");
const AddSong_1 = require("./Constructor/AddSong");
const Buttons_1 = require("./Constructor/Buttons");
class EventMessage extends events_1.EventEmitter {
    constructor() {
        super();
        this.onUpdateMessage = async (message) => new Promise(async (res) => {
            let queue = message.client.queue.get(message.guild.id);
            if (message?.embeds[0]?.fields?.length === 1)
                return res(this.ErrorMessage(message.edit({ embeds: [await (0, CurrentPlay_1.CurrentPlay)(message, queue.songs[0], queue)], components: [(0, Buttons_1.RunButt)()] }).then(async (msg) => queue.channels.message = msg), 'update', false));
            return res(null);
        });
        this.onPlaySongMessage = async (message) => new Promise(async (res) => {
            const queue = message.client.queue.get(message.guild.id);
            const exampleEmbed = await (0, CurrentPlay_1.CurrentPlay)(message, queue.songs[0], queue);
            await this.ErrorMessage(queue.channels.message.delete(), 'playSong', true);
            return res(this.AddInQueueMessage(message, exampleEmbed, (0, Buttons_1.RunButt)(), queue));
        });
        this.onWarningMessage = async (message, song, err = null) => new Promise(async (res) => res(this.SendMessage(message, await (async () => new Warning_1.Warning(message, song, message.client.queue.get(message.guild.id), err))(), null, 10e3, 'warning')));
        this.onPushMessage = async (message, song) => new Promise(async (res) => {
            this.emit('update', message);
            return res(this.SendMessage(message, await (async () => new AddSong_1.AddSong(message, song, message.client.queue.get(message.guild.id)))(), null, 5e3, 'push'));
        });
        this.SendMessage = async (message, Embed, component, time = 5e3, type) => new Promise(async (res) => res(this.DeleteMessage(message.channel.send(!component ? { embeds: [Embed] } : { embeds: [Embed], components: [component] }), time, type)));
        this.DeleteMessage = async (send, time = 5e3, type) => new Promise(async (res) => res(this.ErrorMessage(send.then(async (msg) => setTimeout(async () => this.ErrorMessage(msg.delete(), type, true), time)), type, false)));
        this.ErrorMessage = async (send, type, del) => send.catch(async (e) => console.log(!del ? `[MessageEmitter]: [on: ${type}, ${e.code}]: ${e}` : `[MessageEmitter]: [Method: ${e.method}, ${e.code}]: [on: ${type}]: ${e}`));
        this.AddInQueueMessage = async (message, embed, component, { channels }) => new Promise(async (res) => res(this.ErrorMessage(message.channel.send({ embeds: [embed], components: [component] }).then(async (msg) => channels.message = msg), 'playSong', false)));
        this.on('update', this.onUpdateMessage);
        this.on('playSong', this.onPlaySongMessage);
        this.on('warning', this.onWarningMessage);
        this.on('push', this.onPushMessage);
        this.setMaxListeners(4);
    }
}
exports.EventMessage = EventMessage;
