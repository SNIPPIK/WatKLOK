import { Command, ResolveData } from "@Client/Command";
import { ApplicationCommandOptionType } from "discord.js";
import { ClientMessage } from "@Client/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з", "search", "find"],
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",
            usage: "<url>| <name song> | <platform> <name song>",

            permissions: { client: ["Speak", "Connect"], user: [] },
            options: [
                {
                    name: "query",
                    description: "Необходимо указать ссылку или название трека!",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],
            cooldown: 8
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData | Promise<ResolveData> => {
        const { author, member, guild, client } = message;
        const queue = client.player.queue.get(guild.id);
        const search: string = args.join(" ");
        const voiceChannel = member?.voice?.channel;

        //Если пользователь не подключен к голосовым каналам
        if (!voiceChannel) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если пользователь не указал аргумент
        if (!search) return { text: `${author}, Укажи ссылку или название!`, color: "Yellow" };

        try {
            client.player.play(message, search);
        } catch (e) {
            return { text: `Произошла ошибка -> ${search}\n${e}`, color: "DarkRed", codeBlock: "css" };
        }
    };
}