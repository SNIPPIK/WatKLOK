import {ApplicationCommandOptionType, ChannelType} from "discord.js";
import {ClientMessage} from "@Client/Message";
import {Command, ResolveData} from "@Command";

export default class extends Command {
    public constructor() {
        super({
            name: "stage",
            description: "Запрос на транслирование музыки в трибуну!",
            permissions: { client: ["Speak", "Connect", "RequestToSpeak"], user: [] },

            options: [
                {
                    name: "choice",
                    description: "Варианты взаимодействия с трибунами!",
                    type: ApplicationCommandOptionType.String,
                    choices: [
                        {
                            name: "join - Подключение к трибуне",
                            value: "join"
                        },
                        {
                            name: "request - Запрос на подключение",
                            value: "request"
                        }
                    ],
                    required: true
                }
            ],

            cooldown: 10
        });
    };

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData | Promise<ResolveData> => {
        const { author, member, guild, client } = message;
        const voiceChannel = member?.voice?.channel;
        const queue = client.queue.get(guild.id);
        const me = message.guild.members?.me;

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!voiceChannel) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если текстовые каналы совпадают
        if (queue.message.channelId === message.channelId) return { text: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

        //Если голосовой канал не трибуна
        if (voiceChannel.type === ChannelType.GuildVoice) return { text: `${author}, этот голосовой канал не является трибуной!`, color: "Yellow" }

        return new Promise<ResolveData>((resolve) => {
            (args[0] === "join" ? me.voice.setSuppressed : me.voice.setRequestToSpeak)(true)
                .then(() => {
                    if (args[0] === "join") return resolve({text: `${author}, подключение к трибуне произведено!`, color: "Green"});
                    return resolve({text: `${author}, запрос на трибуну отправлен!`, color: "Green"});
                })
                .catch((err) => {
                    if (args[0] === "join") return resolve({text: `${author}, не удалось подключится к трибуне!`, color: "DarkRed"});
                    return resolve({text: `${author}, не удалось отправить запрос!`, color: "Green"});
                });
        });
    };
}