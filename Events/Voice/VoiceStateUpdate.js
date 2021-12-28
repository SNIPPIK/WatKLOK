"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const voice_1 = require("@discordjs/voice");
const IsDestroyStatus = new Set(['playing', 'paused']);
class voiceStateUpdate {
    constructor() {
        this.run = async (oldState, newState, client) => {
            const queue = client.queue.get(oldState.guild.id);
            if (queue) {
                let voiceConnection = client.connections(oldState.guild);
                if (!voiceConnection.find((fn) => fn.id === client.user.id)) {
                    queue.songs = [];
                    queue.options.stop = true;
                    return queue.events.queue.emit('DestroyQueue', queue, queue.channels.message);
                }
                return this.CheckToRun(voiceConnection, client, oldState, queue);
            }
        };
        this.CheckToRun = async (voiceConnection, client, oldState, { player, AutoDisconnect, songs, options, channels, events }) => {
            const PlayableVoiceChannel = (0, voice_1.getVoiceConnection)(oldState.guild.id);
            if (voiceConnection && PlayableVoiceChannel) {
                if (voiceConnection.length <= 1 && IsDestroyStatus.has(player.state.status))
                    return events.helper.emit('StartTimerDestroyer', { player, AutoDisconnect, songs, options, channels, events });
                else
                    events.helper.emit('CancelTimerDestroyer', { AutoDisconnect, player });
            }
        };
        this.name = 'voiceStateUpdate';
        this.enable = true;
    }
}
exports.default = voiceStateUpdate;
