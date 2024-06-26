import {ApplicationCommandOptionType, ChannelType, StageChannel, VoiceChannel} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("voice")
                .setDescription("Взаимодействие с голосовыми подключениями")
                .addSubCommands([
                    {
                        name: "leave",
                        description: "Отключение от голосового канала!",
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "re-configure",
                        description: "Переподключение к голосовому каналу!",
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
                ]).json,
            execute: async ({message, args, sub}) => {
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
                    case "re-configure": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return { content: `${author} | Я не подключен к голосовому каналу!`, color: "Yellow" };

                        //Перенастройка подключения
                        voiceConnection.configureSocket();

                        return {content: `${author} | Перенастройка подключения!`};
                    }
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
                        const voiceConnection = Voice.get(guild.id);

                        //Если голосовой канал не трибуна
                        if (voiceChannel.type === ChannelType["GuildVoice"]) return {
                            content: `${author} | Этот голосовой канал не является трибуной!`,
                            color: "Yellow"
                        }

                        //Если бот не подключен к голосовому каналу
                        else if (!voiceConnection) {
                            Voice.join({
                                channelId: message.channelId,
                                guildId: message.guildId,
                                selfDeaf: false,
                                selfMute: true
                            }, message.guild.voiceAdapterCreator);
                        }
                        try {
                            if (args[0] === "join") await me.voice.setSuppressed(true);
                            else await me.voice.setRequestToSpeak(true);
                        } catch (err) {
                            return {
                                content: args[0] === "join" ? `${author} | Не удалось подключиться к трибуне!` :`${author} | Не удалось отправить запрос!`,
                                color: "Yellow"
                            }
                        }

                        return {
                            content: args[0] === "join" ? `${author} | Подключение к трибуне произведено!` : `${author} | Запрос на трибуну отправлен!`,
                            color: "Green"
                        };
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});
