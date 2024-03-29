import {ApplicationCommandOptionType, StageChannel, VoiceChannel, ChannelType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            name: "voice",
            description: "Взаимодействие с голосовыми подключениями",
            permissions: ["Speak", "Connect"],

            options: [
                {
                    name: "leave",
                    description: "Отключение от голосового канала!",
                    type: ApplicationCommandOptionType.Subcommand
                },
                {
                    name: "stage",
                    description: "Запрос на транслирование музыки в трибуну!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "choice",
                            description: "Варианты взаимодействия с трибунами!",
                            required: true,
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
                            ]
                        }
                    ]
                }
            ],

            execute: ({message, args, sub}) => {
                const { author, member, guild } = message;
                const voiceChannel: VoiceChannel | StageChannel = member.voice.channel;
                const me = message.guild.members?.me;
                const queue = db.audio.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author} | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!voiceChannel) return { content: `${author} | Необходимо подключиться к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                switch (sub) {
                    case "leave": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return {
                            content: `${author} | Я не подключен к голосовому каналу!`,
                            color: "Yellow"
                        };

                        voiceConnection.disconnect();
                        if (queue) return {content: `${author}, отключение от голосового канала! Очередь будет удалена!`};

                        return {content: `${author}, отключение от голосового канала!`};
                    }
                    case "stage": {
                        //Если текстовые каналы совпадают
                        if (queue.message.channelId === message.channelId) return { content: `${author} | Этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                        //Если голосовой канал не трибуна
                        else if (voiceChannel.type === ChannelType["GuildVoice"]) return { content: `${author} | Этот голосовой канал не является трибуной!`, color: "Yellow" }

                        return new Promise((resolve) => {
                            (args[0] === "join" ? me.voice.setSuppressed : me.voice.setRequestToSpeak)(true)
                                .then(() => {
                                    if (args[0] === "join") return resolve({content: `${author} | Подключение к трибуне произведено!`, color: "Green"});
                                    return resolve({content: `${author} | Запрос на трибуну отправлен!`, color: "Green"});
                                })
                                .catch(() => {
                                    if (args[0] === "join") return resolve({content: `${author} | Не удалось подключиться к трибуне!`, color: "Yellow"});
                                    return resolve({content: `${author} | Не удалось отправить запрос!`, color: "Yellow"});
                                });
                        });
                    }
                }
            }
        });
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});