import { StageChannel, VoiceChannel } from "discord.js";
import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "join",
            description: "Подключение к вашему голосовому каналу!",

            permissions: ["Speak", "Connect"],

            execute: (message) => {
                const { author, member, guild } = message;
                const voiceChannel: VoiceChannel | StageChannel = member.voice.channel;
                const queue = db.music.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если пользователь пытается подключить бота к тому же каналу
                else if (voiceChannel.id === guild.members.me.voice.id || queue && voiceChannel.id === queue.voice.id && guild.members.me.voice.channel) return { content: `${author}, Я уже в этом канале <#${voiceChannel.id}>.`, color: "Yellow" };

                //Если нет очереди
                else if (!queue) return { content: `${author}, Я подключусь сам когда надо! В данный момент музыка не играет!`, color: "Yellow" };

                queue.message = message as any;
                queue.voice = voiceChannel;
                return { content: `${author}, Переподключение к ${queue.voice}`, color: "Yellow" };
            }
        });
    };
}