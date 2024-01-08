import {ApplicationCommandOptionType, ChannelType} from "discord.js";
import {ActionType, Command} from "@Client";
import {db} from "@src";

export default class extends Command {
    public constructor() {
        super({
            name: "stage",
            description: "Запрос на транслирование музыки в трибуну!",
            permissions: ["Speak", "Connect", "RequestToSpeak"],

            options: [
                {
                    name: "choice",
                    description: "Варианты взаимодействия с трибунами!",
                    type: ApplicationCommandOptionType["String"],
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

            execute: (message, args) => {
                const { author, member, guild } = message;
                const voiceChannel = member?.voice?.channel;
                const queue = db.music.queue.get(guild.id);
                const me = message.guild.members?.me;

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!voiceChannel) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текстовые каналы совпадают
                else if (queue.message.channelId === message.channelId) return { content: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                //Если голосовой канал не трибуна
                else if (voiceChannel.type === ChannelType["GuildVoice"]) return { content: `${author}, этот голосовой канал не является трибуной!`, color: "Yellow" }

                return new Promise<ActionType.command>((resolve) => {
                    (args[0] === "join" ? me.voice.setSuppressed : me.voice.setRequestToSpeak)(true)
                        .then(() => {
                            if (args[0] === "join") return resolve({content: `${author}, подключение к трибуне произведено!`, color: "Green"});
                            return resolve({content: `${author}, запрос на трибуну отправлен!`, color: "Green"});
                        })
                        .catch(() => {
                            if (args[0] === "join") return resolve({content: `${author}, не удалось подключится к трибуне!`, color: "DarkRed"});
                            return resolve({content: `${author}, не удалось отправить запрос!`, color: "Green"});
                        });
                });
            }
        });
    };
}