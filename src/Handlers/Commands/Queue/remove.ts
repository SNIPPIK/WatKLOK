import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {MessageUtils} from "@Util/Message";
import {Song} from "@AudioPlayer/Queue/Song";

export default class extends Command {
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
            ]
        })
    };

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);
        const arg = args[0] ? parseInt(args[0]) : 1;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если аргумент не число
        if (isNaN(arg)) return { text: `${author}, Это не число!`, color: "Yellow" };

        //Если аргумент больше кол-ва треков
        if (arg > queue.songs.length) return { text: `${author}, Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, color: "Yellow" };

        //Если музыку нельзя пропустить из-за плеера
        if (!queue.player.hasSkipped) return void (MessageUtils.send = { text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        const {title}: Song = queue.songs[arg - 1];

        if (arg === 1) {
            if (queue.options.loop !== "off") {
                queue.songs.splice(0, 1); //Удаляем первый трек
                queue.player.stop;
            } else queue.player.stop;
        } else queue.songs.splice(arg - 1, 1); //Удаляем трек указанный пользователем

        //Сообщаем какой трек был убран
        return void (MessageUtils.send = { text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color: "Green" });
    };
}