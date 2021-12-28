"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceEvents = void 0;
const events_1 = require("events");
class VoiceEvents extends events_1.EventEmitter {
    constructor() {
        super();
        this.onStartTimerDestroyer = async ({ player, AutoDisconnect, songs, options, channels, events }) => {
            player.pause(true);
            AutoDisconnect.state = true;
            if (!AutoDisconnect.timer)
                AutoDisconnect.timer = setTimeout(async () => {
                    songs = [];
                    options.stop = true;
                    return events.queue.emit('DestroyQueue', { songs, player, options, channels, events }, channels.message, false);
                }, 2e4);
            return null;
        };
        this.onCancelTimerDestroyer = async ({ AutoDisconnect, player }) => {
            if (AutoDisconnect.state === true) {
                AutoDisconnect.state = false;
                clearTimeout(AutoDisconnect.timer);
                AutoDisconnect.timer = null;
                return player.unpause();
            }
            return null;
        };
        this.on('StartTimerDestroyer', this.onStartTimerDestroyer);
        this.on('CancelTimerDestroyer', this.onCancelTimerDestroyer);
        this.setMaxListeners(2);
    }
    ;
}
exports.VoiceEvents = VoiceEvents;
