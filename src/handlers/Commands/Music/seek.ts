import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {Duration} from "@Util/Duration";
import {Song} from "@AudioPlayer/Queue/Song";

export default class extends Command {
    public constructor() {
        super({
            name: "seek",
            description: "Пропуск времени в текущем треке!",

            usage: "00:20 | 20",
            options: [{
                name: "value",
                description: "Пример - 00:00",
                required: true,
                type: ApplicationCommandOptionType["String"]
            }],
            cooldown: 10
        });
    };

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);
        const ArgDuration: any[] = args.join(" ").split(":");
        let EndDuration: number;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return {
            text: `${author}, Необходимо подключится к голосовому каналу!`,
            color: "Yellow"
        };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
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
        const { title }: Song = queue.song;

        //Если пользователь указал времени больше чем в треке
        if (EndDuration > queue.song.duration.seconds) return { text: `${author}, Ты указал слишком много времени!`, color: "Yellow" };

        //Если музыку нельзя пропустить из-за плеера
        if (!queue.player.hasSkipped) return { text: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

        //Начинаем проигрывание трека с <пользователем указанного тайм кода>
        queue.play = EndDuration;

        //Отправляем сообщение о пропуске времени
        return { text: `⏭️ | Seeking to [${Duration.parseDuration(EndDuration)}] song | ${title}`, codeBlock: "css", color: "Green" };
    };
}