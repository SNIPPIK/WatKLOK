import { Command, ResolveData } from "@Structures/Handlers";
import { StageChannel, VoiceChannel } from "discord.js";
import { Queue } from "@AudioPlayer/Structures/Queue";
import { ClientMessage } from "@Client/Message";
import { Voice } from "@Utils/Voice";

export class JoinCommand extends Command {
    public constructor() {
        super({
            name: "join",
            aliases: ["summon", "j"],
            description: 'Подключение к вашему голосовому каналу!',

            permissions: {
                user: null,
                client: ['Speak', 'Connect']
            },

            isGuild: true,
            isSlash: true,
            isEnable: true,
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const { author, member, guild, client } = message;
        const voiceChannel: VoiceChannel | StageChannel = member.voice.channel;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "Yellow" };

        //Если пользователь пытается подключить бота к тому же каналу
        if (voiceChannel.id === guild.members.me.voice.id || queue && voiceChannel.id === queue.voice.id) return { text: `${author}, Я уже в этом канале <#${voiceChannel}>.`, color: "Yellow" };

        if (queue) { //Если есть очередь, то
            //Если включен режим радио
            if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

            const connection = Voice.Join(voiceChannel); //Подключаемся к голосовому каналу

            queue.message = message;
            queue.voice = voiceChannel;

            queue.player.connection = connection; //Подключаем голосовой канал к плееру

            client.player.queue.timeDestroying(guild.id, "cancel"); //Отменяем удаление очереди
            return { text: `${author}, Переподключение к ${queue.voice}!`, color: "Yellow" };
        }

        //Просто подключаемся к голосовому каналу
        Voice.Join(voiceChannel);
        return { text: `${author}, Подключение к ${voiceChannel}!`, color: "Yellow" };
    };
}