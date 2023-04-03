import { Command, ResolveData } from "@Structures/Handle/Command";
import { ApplicationCommandOptionType } from "discord.js";
import { Queue } from "@AudioPlayer/Structures/Queue";
import { ClientMessage } from "@Client/Message";

export class PlayCommand extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з", "search", "find"],
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",
            usage: "url_name song | platform_name song",

            permissions: { client: ["Speak", "Connect"], user: [] },
            options: [
                {
                    name: "parameter",
                    description: "Название трека, ссылку на трек или тип yt, sp, sc, vk, ym!",
                    required: true,
                    type: ApplicationCommandOptionType.String
                },
                {
                    name: "search",
                    description: "Прошлый аргумент должен быть тип, теперь укажи название трека!",
                    required: false,
                    type: ApplicationCommandOptionType.String
                }
            ],

            isEnable: true,
            isSlash: true,

            isCLD: 8
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData | Promise<ResolveData> => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);
        const search: string = args.join(" ");
        const voiceChannel = member?.voice;

        //Если пользователь не подключен к голосовым каналам
        if (!voiceChannel?.channel || !voiceChannel) return { text: `${author}, Подключись к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && voiceChannel?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если пользователь не указал аргумент
        if (!search) return { text: `${author}, Укажи ссылку, название или прикрепи файл и укажи на него ссылку!`, color: "Yellow" };

        try {
            client.player.play(message, search);
        } catch (e) {
            return { text: `Произошла ошибка -> ${search}\n${e}`, color: "DarkRed", codeBlock: "css" };
        }
    };
}