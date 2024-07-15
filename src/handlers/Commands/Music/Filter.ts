import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class Command_Filter
 * @command filter
 * @description Модификация текущего и последующих потоков
 */
class Command_Filter extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("filter")
                .setDescription("Управление фильтрами")
                .setDescriptionLocale({
                    "en-US": "Filter Management"
                })
                .addSubCommands([
                    {
                        name: "add",
                        description: "Добавление фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Adding filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                descriptionLocalizations: {
                                    "en-US": "You need to select a filter! All available filters are all"
                                },
                                type: ApplicationCommandOptionType["String"],
                                choices: db.audio.filters.length < 25 ? db.audio.filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        nameLocalizations: {
                                            "en-US": `${filter.name} | ${filter.description_localizations["en-US"].length > 75 ? `${filter.description_localizations["en-US"].substring(0, 75)}...` : filter.description_localizations["en-US"]}`
                                        },
                                        value: filter.name
                                    }
                                }) : []
                            },
                            {
                                name: "argument",
                                description: "Аргумент для фильтра, если он необходим!",
                                descriptionLocalizations: {
                                    "en-US": "An argument for the filter, if necessary!"
                                },
                                type: ApplicationCommandOptionType["String"]
                            }
                        ]
                    },
                    {
                        name: "remove",
                        description: "Удаление фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Removing filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                descriptionLocalizations: {
                                    "en-US": "You need to select a filter! All available filters are all"
                                },
                                type: ApplicationCommandOptionType["String"],
                                choices: db.audio.filters.length < 25 ? db.audio.filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        nameLocalizations: {
                                            "en-US": `${filter.name} | ${filter.description_localizations["en-US"].length > 75 ? `${filter.description_localizations["en-US"].substring(0, 75)}...` : filter.description_localizations["en-US"]}`
                                        },
                                        value: filter.name
                                    }
                                }) : []
                            }
                        ]
                    },
                    {
                        name: "off",
                        description: "Отключение всех фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Disable all filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "list",
                        description: "Списки",
                        descriptionLocalizations: {
                            "en-US": "Filter list"
                        },
                        type: ApplicationCommandOptionType.SubcommandGroup,
                        options: [
                            {
                                name: "current",
                                description: "Текущие фильтры!",
                                descriptionLocalizations: {
                                    "en-US": "Current filters!"
                                },
                                type: ApplicationCommandOptionType.Subcommand
                            },
                            {
                                name: "total",
                                description: "Доступные фильтры!",
                                descriptionLocalizations: {
                                    "en-US": "Available filters!"
                                },
                                type: ApplicationCommandOptionType.Subcommand
                            }
                        ]
                    }
                ])
                .json,
            intents: ["voice", "queue", "anotherVoice"],
            execute: ({message, args, sub}) => {
                const { author, member, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                //Если статус плеера не позволяет пропустить поток
                if (!queue.player.playing) return {
                    content: locale._(message.locale,"player.wait", [author]),
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return {
                    content: locale._(message.locale,"command.filter.live", [author]),
                    color: "Yellow"
                };

                const seek: number = queue.player.stream?.duration ?? 0;
                const name = args[args?.length - 2 ?? args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;
                const Filter = db.audio.filters.find((item) => item.name === name);
                const index = queue.player.filters.indexOf(Filter);

                switch (sub) {
                    case "current":
                    case "total": {
                        let array = db.audio.filters;
                        if (sub === "current") {
                            //Если нет фильтров
                            if (queue?.player.filters.length === 0) return {
                                content: locale._(message.locale,"command.filter.total.current.null", [author.username]),
                                codeBlock: "css"
                            };

                            array = queue?.player?.filters;
                        }

                        //Преобразуем все фильтры в string
                        const pages = array.ArraySort(5, (filter, index) => {
                            return locale._(message.locale,"command.filter.list", [
                                index + 1, filter.name ? `(${filter.name})` : `Нет`,
                                filter.args ? `(${filter.args})` : `Нет`,
                                filter.speed ? `${filter.speed}` : `Нет`,
                                filter.description ? `(${filter.description})` : `Нет`
                            ]);
                        });

                        return new MessageBuilder().addEmbeds([
                            {
                                title: locale._(message.locale,"command.filter.all"),
                                description: pages[0],
                                color: Colors.Yellow,
                                thumbnail: { url: message.client.user.avatarURL() },
                                timestamp: new Date(),
                                footer: {
                                    text: locale._(message.locale,"global.listOf", [message.author.username, 1, pages.length]), iconURL: message.author.displayAvatarURL()
                                }
                            }
                        ]).setPages(pages).setTime(60e3).setCallback((msg, pages, page, embed) => {
                            return msg.edit({
                                embeds: [{ ...embed[0], description: pages[page - 1],
                                    footer: {
                                        ...embed[0].footer,
                                        text: locale._(message.locale,"global.listOf", [message.author.username, page, pages.length])
                                    }
                                }]
                            });
                        })
                    }
                    case "off": {
                        //Если нет фильтров
                        if (queue?.player.filters.length === 0) return {
                            content: locale._(message.locale,"command.filter.total.current.null", [author.username])
                        };

                        queue.player.filters.splice(0, queue.player.filters.length); //Удаляем фильтр
                        queue.player.play(queue.songs.song, seek);
                        return;
                    }

                    case "add": {
                        //Пользователь пытается включить включенный фильтр
                        if (index !== -1) return {
                            content: locale._(message.locale,"command.filter.enable.retry", [name]),
                            color: "Yellow"
                        };

                        //Делаем проверку на совместимость
                        for (let i = 0; i < queue.player.filters.length; i++) {
                            const filter = queue.player.filters[i];

                            if (Filter.unsupported.includes(filter.name)) return {
                                content: locale._(message.locale,"command.filter.not.support", [author.username, filter.name, Filter.name])
                            };
                        }

                        if (Filter.args) {
                            const isOkArgs = arg && arg >= Filter.args[0] && arg <= Filter.args[1];

                            //Если аргументы не подходят
                            if (!isOkArgs) return {
                                content: locale._(message.locale,"command.filter.not.enable", [name, Filter.args[0], Filter.args[1]]),
                                color: "Yellow",
                            };
                        }

                        //Если надо добавить аргумент
                        if (arg && Filter.args) Filter.user_arg = arg;

                        queue.player.filters.push(Filter);
                        queue.player.play(queue.songs.song, seek);

                        return {
                            content: locale._(message.locale,"command.filter.enable", [Filter.user_arg ? `${name}:${args}` : name]),
                            color: "Green",
                            replied: false
                        };
                    }
                    case "remove": {
                        //Пользователь пытается выключить выключенный фильтр
                        if (index === -1) return {
                            content: locale._(message.locale,"command.filter.disable.retry", [name]),
                            color: "Yellow"
                        };

                        queue.player.filters.splice(index, 1); //Удаляем фильтр
                        queue.player.play(queue.songs.song, seek);
                        return {
                            content: locale._(message.locale,"command.filter.disable", [name]),
                            color: "Green",
                            replied: false
                        };
                    }
                }
            }
        });
    };
}

/**
 * @class Command_Seek
 * @command seek
 * @description Пропуск времени в текущем треке
 *
 * @param value - Время для пропуска времени
 */
class Command_Seek extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("seek")
                .setDescription("Пропуск времени в текущем треке!")
                .setDescriptionLocale({
                    "en-US": "Skipping the time in the current track!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Пример - 00:00",
                        descriptionLocalizations: {
                            "en-US": "Example - 00:00"
                        },
                        required: true,
                        type: ApplicationCommandOptionType["String"]
                    }
                ])
                .json,
            intents: ["queue", "voice", "anotherVoice"],
            execute: ({message, args}) => {
                const {author, member, guild} = message;
                const queue = db.audio.queue.get(guild.id);

                //Если текущий трек является потоковым
                if (queue.songs.song.duration.seconds === 0) return {
                    content: locale._(message.locale, "player.audio.live", [author]),
                    color: "Yellow"
                };

                //Если пользователь не указал время
                else if (!args[0]) return {
                    content: locale._(message.locale, "command.ffmpeg.seek.args.null", [author]),
                    color: "Yellow"
                };

                const duration = args[0].duration();

                //Если пользователь написал что-то не так
                if (isNaN(duration)) return {
                    content: locale._(message.locale, "global.arg.NaN", [author]),
                    color: "Yellow"
                };

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.songs.song.duration.seconds) return {
                    content: locale._(message.locale, "command.ffmpeg.seek.args.big", [author]),
                    color: "Yellow"
                };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) return {
                    content: locale._(message.locale, "player.played.not", [author]),
                    color: "Yellow"
                };

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(queue.songs.song, duration);

                //Отправляем сообщение о пропуске времени
                return {
                    content: locale._(message.locale,"command.ffmpeg.seek.end", [args[0], queue.songs.song.title]),
                    codeBlock: "css",
                    color: "Green"
                };
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Filter, Command_Seek});