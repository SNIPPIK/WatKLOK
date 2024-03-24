import {ApplicationCommandOptionType, StageChannel, VoiceChannel, ChannelType} from "discord.js";
import {Constructor, handler} from "@handler";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

class Group extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "voice",
            description: "Взаимодействие с голосовыми подключениями",
            permissions: ["Speak", "Connect"],

            options: [
                {
                    name: "join",
                    description: "Подключение к вашему голосовому каналу!",
                    type: ApplicationCommandOptionType.Subcommand
                },
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
                const queue = db.queue.get(guild.id);

                switch (sub) {
                    case "join": {
                        //Если пользователь не подключен к голосовым каналам
                        if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                        //Если пользователь пытается подключить бота к тому же каналу
                        else if (voiceChannel.id === guild.members.me.voice.id || queue && voiceChannel.id === queue.voice.id && guild.members.me.voice.channel) return { content: `${author}, Я уже в этом канале <#${voiceChannel.id}>.`, color: "Yellow" };

                        //Если нет очереди
                        else if (!queue) return { content: `${author}, Я подключусь сам когда надо! В данный момент музыка не играет!`, color: "Yellow" };

                        queue.message = message as any;
                        queue.voice = voiceChannel;
                        return { content: `${author}, Переподключение к ${queue.voice}`, color: "Yellow" };
                    }
                    case "leave": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return {
                            content: `${author}, я не подключен к голосовому каналу!`,
                            color: "Yellow"
                        };

                        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                        else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
                            content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                            color: "Yellow"
                        };

                        voiceConnection.disconnect();
                        if (queue) return {content: `${author}, отключение от голосового канала! Очередь будет удалена!`};

                        return {content: `${author}, отключение от голосового канала!`};
                    }
                    case "stage": {
                        //Если нет очереди
                        if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                        //Если пользователь не подключен к голосовым каналам
                        else if (!voiceChannel) return { content: `${author}, Необходимо подключиться к голосовому каналу!`, color: "Yellow" };

                        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                        else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                            content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                            color: "Yellow"
                        };

                        //Если текстовые каналы совпадают
                        else if (queue.message.channelId === message.channelId) return { content: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                        //Если голосовой канал не трибуна
                        else if (voiceChannel.type === ChannelType["GuildVoice"]) return { content: `${author}, этот голосовой канал не является трибуной!`, color: "Yellow" }

                        return new Promise((resolve) => {
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