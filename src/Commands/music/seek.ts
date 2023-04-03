import { Command, ResolveData } from "@Structures/Handle/Command";
import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Structures/Queue";
import { ClientMessage } from "@Client/Message";

export class SeekCommand extends Command {
    public constructor() {
        super({
            name: "seek",
            aliases: ["begin", "sek", "beg"],
            description: "Пропуск времени в текущем треке!",

            usage: "00:00 | 20",
            options: [{
                name: "value",
                description: "Пример - 00:00",
                required: true,
                type: ApplicationCommandOptionType.String
            }],

            isEnable: true,
            isSlash: true,

            isCLD: 10
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);
        const ArgDuration: any[] = args.join(" ").split(":");
        let EndDuration: number;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return {
            text: `${author}, Подключись к голосовому каналу!`,
            color: "Yellow"
        };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        //Если текущий трек является потоковым
        if (queue.song.options.isLive) return { text: `${author}, А как? Это же стрим!`, color: "Yellow" };

        //Если пользователь не указал время
        if (!ArgDuration) return { text: `${author}, Укажи время, пример 00:00:00!`, color: "Yellow" };
        else if (ArgDuration.length > 1) {
            if (!ArgDuration[2]) EndDuration = (ArgDuration[0] * 60) + (ArgDuration[1] % 60000);
            else EndDuration = (ArgDuration[0] * 60 * 60) + (ArgDuration[1] * 60) + (ArgDuration[2] % 60000);
        } else EndDuration = parseInt(args[0]);

        //Если пользователь написал что-то не так
        if (isNaN(EndDuration)) return {
            text: `${author}, Я не могу определить что ты написал, попробуй еще раз!`,
            color: "Yellow"
        };

        //Если пользователь указал времени больше чем в треке
        if (EndDuration > queue.song.duration.seconds) return { text: `${author}, Ты указал слишком много времени!`, color: "Yellow" };

        return void client.player.seek(message, EndDuration);
    };
}