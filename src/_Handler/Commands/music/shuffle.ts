import {Command, ResolveData} from "@Handler/FileSystem/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {ApplicationCommandOptionType} from "discord.js";
import {Queue} from "@Queue/Queue";
import {Song} from "@Queue/Song";

export class ShuffleCommand extends Command {
    public constructor() {
        super({
            name: "shuffle",
            description: "Перетасовка музыки в очереди текущего сервера!",

            options: [{
                name: "value",
                description: "Shuffle queue songs",
                required: true,
                type: ApplicationCommandOptionType.String
            }],

            isEnable: true,
            isSlash: true
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const {author, member, guild, client} = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${author}, Невозможно из-за включенного режима радио!`, color: "Yellow" };

        //Если нет треков в очереди
        if (!queue.songs) return { text: `${author}, Нет музыки в очереди!`, color: "Yellow" };

        //Если треков меньше 3
        if (queue.songs.length < 3) return { text: `${author}, Очень мало музыки, нужно более 3`, color: "Yellow" };

        this.shuffleSongs(queue.songs);
        return {text: `🔀 | Shuffle total [${queue.songs.length}]`, codeBlock: "css"};
    };

    private shuffleSongs = (songs: Song[]): void => {
        for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
        }
    };
}