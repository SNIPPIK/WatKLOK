import { StageChannel, VoiceChannel } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";
import { Voice } from "@Util/Voice";

export default class extends Command {
    public constructor() {
        super({
            name: "join",
            aliases: ["summon", "j"],
            description: 'Подключение к вашему голосовому каналу!',

            permissions: {
                user: null,
                client: ['Speak', 'Connect']
            }
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const voiceChannel: VoiceChannel | StageChannel = member.voice.channel;
        const queue: Queue = client.queue.get(guild.id);

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если пользователь пытается подключить бота к тому же каналу
        if (voiceChannel.id === guild.members.me.voice.id || queue && voiceChannel.id === queue.voice.id && guild.members.me.voice.channel) return { text: `${author}, Я уже в этом канале <#${voiceChannel.id}>.`, color: "Yellow" };

        if (queue) { //Если есть очередь, то
            //Если включен режим радио
            if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

            queue.message = message;
            queue.joinVoice = voiceChannel;
            queue.state = "cancel"; //Отменяем удаление очереди
            return { text: `${author}, Переподключение к ${queue.voice}`, color: "Yellow" };
        }

        //Просто подключаемся к голосовому каналу
        Voice.join(voiceChannel);
        return { text: `${author}, Подключение к ${voiceChannel}`, color: "Yellow" };
    };
}