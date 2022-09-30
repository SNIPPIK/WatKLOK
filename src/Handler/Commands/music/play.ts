import {Command} from "../../../Structures/Command";
import {ApplicationCommandOptionType} from "discord.js";
import {Queue} from "../../../AudioPlayer/Structures/Queue/Queue";
import {Handle} from "../../../AudioPlayer/Player/Searcher";
import {ClientMessage} from "../../Events/Activity/Message";

export class Play extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з"],
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",

            permissions: {client: ["Speak", "Connect"], user: []},
            options: [
                {
                    name: "url-name-type",
                    description: "Укажи что нужно, ссылку, название или тип поиска и название",
                    required: true,
                    type: ApplicationCommandOptionType.String
                },
                {
                    name: "search",
                    description: "Прошлый аргумент, тип? Если да, тут название трека!",
                    required: false,
                    type: ApplicationCommandOptionType.String
                }
            ],
            enable: true,
            slash: true,
            CoolDown: 8
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): void => {
        const voiceMember = message.member.voice;
        const queue: Queue = message.client.queue.get(message.guild.id);
        const search: string = args.join(" ") ?? message.attachments?.last()?.url;

        //Если пользователь не подключен к голосовым каналам
        if (!message.member?.voice?.channel || !message.member?.voice) return message.client.sendMessage({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: "DarkRed"
        });

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && message.member?.voice?.channel?.id !== queue.voice.id) return message.client.sendMessage({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            message,
            color: "DarkRed"
        });

        //Если пользователь не указал аргумент
        if (!search) return message.client.sendMessage({
            text: `${message.author}, Укажи ссылку, название или прикрепи файл!`,
            message,
            color: "DarkRed"
        });


        return Handle.toPlayer({message, voiceChannel: voiceMember.channel, search});
    };
}