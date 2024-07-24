import {ApplicationCommandOptionType, ChannelType, StageChannel, VoiceChannel} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @class Command_Voice
 * @command voice
 * @description Управление голосовыми подключениями
 */
class Command_Voice extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("voice")
                .setDescription("Взаимодействие с голосовыми подключениями")
                .setDescriptionLocale({
                    "en-US": "Interaction with voice connections"
                })
                .addSubCommands([
                    {
                        name: "leave",
                        description: "Отключение от голосового канала!",
                        descriptionLocalizations: {
                            "en-US": "Disconnecting from the voice channel!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "re-configure",
                        description: "Переподключение к голосовому каналу!",
                        descriptionLocalizations: {
                            "en-US": "Reconnect to the voice channel!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "stage",
                        description: "Запрос на транслирование музыки в трибуну!",
                        descriptionLocalizations: {
                            "en-US": "Request to broadcast music to the podium!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "choice",
                                description: "Варианты взаимодействия с трибунами!",
                                descriptionLocalizations: {
                                    "en-US": "Options for interacting with the stands!"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: [
                                    {
                                        name: "join - Подключение к трибуне",
                                        nameLocalizations: {
                                            "en-US": "join - Connecting to the podium"
                                        },
                                        value: "join"
                                    },
                                    {
                                        name: "request - Запрос на подключение",
                                        nameLocalizations: {
                                            "en-US": "request - Connection request"
                                        },
                                        value: "request"
                                    }
                                ]
                            }
                        ]
                    }
                ]).json,
            intents: ["voice", "anotherVoice"],
            execute: async ({message, args, sub}) => {
                const { author, member, guild } = message;
                const VoiceChannel: VoiceChannel | StageChannel = member.voice.channel;
                const me = message.guild.members?.me;
                const queue = db.audio.queue.get(guild.id);

                switch (sub) {
                    case "re-configure": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return {
                            content: locale._(message.locale,"player.voice.bot.inactive", [author]),
                            color: "Yellow"
                        };

                        //Перенастройка подключения
                        voiceConnection.socket();

                        return {
                            content: locale._(message.locale,"command.voice.re-configure", [author]),
                        };
                    }
                    case "leave": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return {
                            content: locale._(message.locale,"player.voice.bot.inactive", [author]),
                            color: "Yellow"
                        };

                        voiceConnection.disconnect();

                        return {
                            content: queue ? locale._(message.locale,"player.voice.leave.forQueue", [author]) : locale._(message.locale,"player.voice.leave", [author])
                        }
                    }
                    case "stage": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если голосовой канал не трибуна
                        if (VoiceChannel.type === ChannelType["GuildVoice"]) return {
                            content: locale._(message.locale,"player.voice.stage", [author]),
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
                                content: args[0] === "join" ? locale._(message.locale,"command.voice.stage.join.error", [author]) :
                                    locale._(message.locale,"command.voice.stage.request.error", [author]),
                                color: "Yellow"
                            }
                        }

                        return {
                            content: args[0] === "join" ? locale._(message.locale,"command.voice.stage.join", [author]) :
                                locale._(message.locale,"command.voice.stage.request", [author]),
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
export default Object.values({Command_Voice});