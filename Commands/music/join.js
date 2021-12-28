"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Voice_1 = require("../../Modules/Music/src/Manager/Voice/Voice");
const Constructor_1 = require("../Constructor");
class CommandJoin extends Constructor_1.Command {
    constructor() {
        super({
            name: "join",
            aliases: ["summon", "j"],
            description: 'Подключение к голосовому каналу',
            permissions: {
                user: null,
                client: ['SPEAK', 'CONNECT']
            },
            enable: true,
        });
        this.run = async (message) => {
            this.DeleteMessage(message, 5e3);
            const voiceChannel = message.member.voice.channel;
            const queue = message.client.queue.get(message.guild.id);
            if (!message.member.voice.channel || !message.member.voice)
                return message.client.Send({ text: `${message.author}, Подключись к голосовому каналу!`, message: message, color: 'RED' });
            if (voiceChannel.id === message.guild.me.voice.id)
                return message.client.Send({ text: `${message.author}, Я уже в этом канале <#${queue.channels.voice.id}>.`, message: message, color: "RED" });
            const VoiceConnection = new Voice_1.VoiceManager().Join(voiceChannel);
            if (queue) {
                queue.channels.voice = voiceChannel;
                queue.channels.connection = VoiceConnection;
            }
            return;
        };
    }
    ;
}
exports.default = CommandJoin;
