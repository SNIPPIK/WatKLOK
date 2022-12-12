import {Command, ResolveData} from "../../../Structures/Handle/Command";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {ApplicationCommandOptionType} from "discord.js";
import {ClientMessage} from "../../Events/Activity/interactionCreate";

export class Remove extends Command {
    public constructor() {
        super({
            name: "remove",
            aliases: [],
            description: "Эта команда удаляет из очереди музыку!",

            usage: "1 | Можно убрать любой трек из очереди | Если аргумент не указан он будет равен 1",
            options: [
                {
                    name: "value",
                    description: "Номер трека который надо удалить из очереди",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],

            isEnable: true,
            isSlash: true
        })
    };

    public readonly run = async (message: ClientMessage, args: string[]): Promise<ResolveData> => {
        const {author, member, guild, client} = message;
        const queue: Queue = client.queue.get(guild.id);
        const argsNum = args[0] ? parseInt(args[0]) : 1;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "DarkRed"
        };

        //Если аргумент не число
        if (isNaN(argsNum)) return { text: `${author}, Это не число!`, color: "DarkRed" };

        //Если аргумент больше кол-ва треков
        if (argsNum > queue.songs.length) return { text: `${author}, Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, color: "DarkRed" };

        return void client.player.emit("remove", message, argsNum);
    };
}