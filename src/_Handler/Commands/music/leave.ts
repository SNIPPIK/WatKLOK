import {Command, ResolveData} from "@Handler/FileSystem/Handle/Command"
import {ClientMessage} from "@Client/interactionCreate";
import { Voice } from "@VoiceManager";
import {Queue} from "@Queue/Queue";

export class LeaveCommand extends Command {
    public constructor() {
        super({
            name: "leave",
            description: "Отключение от голосового канала!",

            isGuild: true,
            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const {guild, member, author, client} = message;
        const queue: Queue = client.queue.get(guild.id);
        const actVoice = Voice.getVoice(guild.id);

        //Если бот не подключен к голосовому каналу
        if (!actVoice) return {text: `${author}, я не подключен к голосовому каналу!`, color: "Yellow"};

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
        };

        //Если включен режим радио
        if (queue && queue.options.radioMode) return {text: `${author}, я не могу отключится из-за включенного режима радио!`};

        Voice.Disconnect(guild.id);
        if (queue) return {text: `${author}, отключение от голосового канала! Очередь будет удалена через **20 сек**!`};
    };
}