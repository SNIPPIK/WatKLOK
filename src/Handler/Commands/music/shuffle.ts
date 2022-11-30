import {Command, ResolveData} from "../../../Structures/Handle/Command";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {Song} from "../../../AudioPlayer/Structures/Queue/Song";
import {ApplicationCommandOptionType} from "discord.js";
import {ClientMessage} from "../../Events/Activity/interactionCreate";

export class Shuffle extends Command {
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

    public readonly run = async (message: ClientMessage): Promise<ResolveData> => {
        const queue: Queue = message.client.queue.get(message.guild.id);

        //Если нет очереди
        if (!queue) return { text: `${message.author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        //Если пользователь не подключен к голосовым каналам
        if (!message.member?.voice?.channel || !message.member?.voice) return { text: `${message.author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && message.member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "DarkRed"
        };

        //Если включен режим радио
        if (queue.options.radioMode) return { text: `${message.author}, Невозможно из-за включенного режима радио!`, color: "DarkRed" };

        //Если нет треков в очереди
        if (!queue.songs) return { text: `${message.author}, Нет музыки в очереди!`, color: "DarkRed" };

        //Если треков меньше 3
        if (queue.songs.length < 3) return { text: `${message.author}, Очень мало музыки, нужно более 3`, color: "DarkRed" };

        this.#shuffleSongs(queue.songs);
        return {text: `🔀 | Shuffle total [${queue.songs.length}]`, codeBlock: "css"};
    };

    readonly #shuffleSongs = (songs: Song[]): void => {
        for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
        }
    };
}