"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = require("node:events");
const CreateQueue_1 = require("./src/Manager/Queue/CreateQueue");
const ControlAudioPlayer_1 = require("./src/AudioPlayer/ControlAudioPlayer");
const PlayLists_1 = require("./src/Manager/Queue/PlayLists");
class ClientPlayer {
    constructor() {
        this.run = (client) => client.player = new PlayerEmitter();
        this.enable = true;
    }
    ;
}
exports.default = ClientPlayer;
class PlayerEmitter extends node_events_1.EventEmitter {
    constructor() {
        super();
        this.on('play', new CreateQueue_1.CreateQueue()._);
        this.on('pause', new ControlAudioPlayer_1.ControlAudioPlayer().pause);
        this.on('resume', new ControlAudioPlayer_1.ControlAudioPlayer().resume);
        this.on('remove', new ControlAudioPlayer_1.ControlAudioPlayer().remove);
        this.on('seek', new ControlAudioPlayer_1.ControlAudioPlayer().seek);
        this.on('skip', new ControlAudioPlayer_1.ControlAudioPlayer().skip);
        this.on('replay', new ControlAudioPlayer_1.ControlAudioPlayer().replay);
        this.on('bass', new ControlAudioPlayer_1.ControlAudioPlayer().bass);
        this.on('speed', new ControlAudioPlayer_1.ControlAudioPlayer().speed);
        this.on('playlist', new PlayLists_1.PlayList().pushItems);
        this.setMaxListeners(10);
    }
    ;
}
