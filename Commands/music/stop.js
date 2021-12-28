"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Voice_1 = require("../../Modules/Music/src/Manager/Voice/Voice");
const Constructor_1 = require("../Constructor");
class CommandStop extends Constructor_1.Command {
    constructor() {
        super({
            name: "stop",
            aliases: ["leave", "disconnect", "discon"],
            description: "Выключение музыки",
            enable: true
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const queue = message.client.queue.get(message.guild.id);
            if (queue) {
                queue.songs = [];
                queue.events.queue.emit('DestroyQueue', queue, message);
                return;
            }
            try {
                new Voice_1.VoiceManager().Disconnect(message.guild.id);
                return message.client.Send({ text: `${message.author}, 👌`, message: message });
            }
            catch (e) {
                return message.client.Send({ text: `${message.author}, 🤔`, message: message });
            }
        };
    }
    ;
}
exports.default = CommandStop;
