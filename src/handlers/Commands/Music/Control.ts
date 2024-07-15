import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {env, Logger} from "@env";
import {db} from "@lib/db";

/**
 * @class Command_Pause
 * @command pause
 * @description Приостановить воспроизведение текущего трека
 */
class Command_Pause extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("pause")
                .setDescription("Приостановить воспроизведение текущего трека?!")
                .setDescriptionLocale({
                    "en-US": "Pause the playback of the current track?!"
                })
                .json,
            intents: ["voice", "queue", "anotherVoice"],
            execute: ({message}) => {
                const { author, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                //Если музыка уже приостановлена
                if (queue.player.status === "player/pause") return {
                    content: locale._(message.locale,"player.paused", [queue.songs.song.title]),
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return {
                    content: locale._(message.locale,"player.audio.live", [author]),
                    color: "Yellow"
                };

                //Приостанавливаем музыку если она играет
                queue.player.pause();
                return {
                    content: locale._(message.locale,"command.control.pause", [queue.songs.song.title]),
                    codeBlock: "css",
                    color: "Green"
                };
            }
        });
    };
}

/**
 * @class Command_Resume
 * @command resume
 * @description Возобновить воспроизведение текущего трека
 */
class Command_Resume extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("resume")
                .setDescription("Возобновить воспроизведение текущего трека?!")
                .setDescriptionLocale({
                    "en-US": "Resume playing the current track?!"
                })
                .json,
            execute: ({message}) => {
                const { author, member, guild } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                //Если музыка уже играет
                if (queue.player.status === "player/playing") return {
                    content: locale._(message.locale,"player.played", [queue.songs.song.title]),
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return {
                    content: locale._(message.locale,"player.audio.live", [author]),
                    color: "Yellow"
                };

                queue.player.resume();
                return {
                    content: locale._(message.locale,"command.control.resume", [queue.songs.song.title]),
                    codeBlock: "css",
                    color: "Green"
                };
            }
        });
    };
}

/**
 * @class Command_Stop
 * @command stop
 * @description Удаление музыкальной очереди
 */
class Command_Stop extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("stop")
                .setDescription("Удаление музыкальной очереди!")
                .setDescriptionLocale({
                    "en-US": "Deleting the music queue!"
                })
                .json,
            execute: ({message}) => {
                const { author, guild, member } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                if (queue.radio) {
                    //@ts-ignore
                    if (!member.permissions.has("MANAGE_SERVER") && env.get("player.radio.admin")) return {
                        content: locale._(message.locale,"player.radio.rule", [author, "MANAGE_SERVER"]),
                        color: "Yellow"
                    };
                }

                db.audio.queue.remove(queue.guild.id);
                return {
                    content: locale._(message.locale,"player.queue.destroy", [author])
                };
            }
        });
    };
}

/**
 * @class Command_Repeat
 * @command repeat
 * @description Включение повтора и выключение повтора музыки
 *
 * @param type - Тип повтора
 */
class Command_Repeat extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("repeat")
                .setDescription("Включение повтора и выключение повтора музыки!")
                .setDescriptionLocale({
                    "en-US": "Turn on the replay and turn off the music replay!"
                })
                .addSubCommands([
                    {
                        name: "type",
                        description: "Тип повтора, необходимо указать!",
                        descriptionLocalizations: {
                            "en-US": "The type of repeat must be specified!"
                        },
                        type: ApplicationCommandOptionType["String"],
                        choices: [
                            {
                                name: "song | Повтор текущего трека",
                                nameLocalizations: {
                                    "en-US": "song | Repeat the current track"
                                },
                                value: "song"
                            },
                            {
                                name: "songs | Повтор всех треков",
                                nameLocalizations: {
                                    "en-US": "songs | Repeat all tracks"
                                },
                                value: "songs"
                            },
                            {
                                name: "off | Выключение повтора",
                                nameLocalizations: {
                                    "en-US": "off | Turning off the replay"
                                },
                                value: "off"
                            }
                        ]
                    }
                ])
                .json,
            execute: ({message, args}) => {
                const { author, member, guild } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                const argument = args?.pop()?.toLowerCase();

                switch (argument) {
                    case "song": {
                        queue.repeat = "song";
                        return {
                            content: locale._(message.locale,"command.control.repeat.one", [queue.songs.song.title]),
                            codeBlock: "css"
                        };
                    }
                    case "songs": {
                        queue.repeat = "songs";
                        return {
                            content: locale._(message.locale,"command.control.repeat.all"),
                            codeBlock: "css"
                        };
                    }
                    case "off": {
                        queue.repeat = "off";
                        return {
                            content: locale._(message.locale,"command.control.repeat.off"),
                            codeBlock: "css"
                        };
                    }
                }
            }
        });
    };
}

/**
 * @class Command_Skip
 * @command skip
 * @description Пропуск трека по номеру
 *
 * @param value - Номер пропускаемого трека
 */
class Command_Skip extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("skip")
                .setDescription("Пропуск текущей музыки!")
                .setDescriptionLocale({
                    "en-US": "Skip the current music!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Укажите какую музыку пропускаем!",
                        descriptionLocalizations: {
                            "en-US": "Specify which music we skip!"
                        },
                        type: ApplicationCommandOptionType["String"]
                    }
                ])
                .json,
            execute: ({message, args}) => {
                const { author, member, guild } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                //Если аргумент не является числом
                if (isNaN(arg)) return {
                    content: locale._(message.locale,"global.arg.NaN", [author])
                };

                //Если пользователь не подключен к голосовым каналам
                else if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                let {player, songs} = queue, {title} = songs[arg - 1];

                try {
                    //Если музыку нельзя пропустить из-за плеера
                    if (!player.playing) return {
                        content: locale._(message.locale,"player.played.not", [author]),
                        color: "Yellow"
                    };

                    //Если пользователь укажет больше чем есть в очереди или меньше
                    else if (arg > songs.length && arg < queue.songs.length) return {
                        content: locale._(message.locale,"command.control.skip.arg", [author, songs.size]),
                        color: "Yellow"
                    };

                    //Если аргумент больше 1, то ищем трек
                    else if (arg > 1) {
                        if (queue.repeat === "songs") for (let i = 0; i < arg - 2; i++) songs.push(songs.shift());
                        else queue.songs.splice(arg - 2, 1);
                    }

                    player.stop();
                    return {
                        content: arg > 1 ? locale._(message.locale,"command.control.skip.songs", [arg, title]) : locale._(message.locale,"command.control.skip.song", [title]),
                        codeBlock: "css",
                        color: "Green"
                    }
                } catch (err) {
                    Logger.log("ERROR", err);
                    return {
                        content: locale._(message.locale,"error.retry", [author]),
                        color: "DarkRed"
                    };
                }
            }
        });
    };
}

/**
 * @class Command_Remove
 * @command remove
 * @description Пропуск трека по номеру
 *
 * @param value - Номер пропускаемого трека
 */
class Command_Remove extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("remove")
                .setDescription("Эта команда удаляет из очереди музыку!")
                .setDescriptionLocale({
                    "en-US": "This command removes music from the queue!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Номер трека который надо удалить из очереди",
                        descriptionLocalizations: {
                            "en-US": "The number of the track to be deleted from the queue"
                        },
                        required: true,
                        type: ApplicationCommandOptionType["String"]
                    }
                ])
                .json,
            execute: ({message, args}) => {
                const { author, member, guild } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                //Если аргумент не является числом
                if (isNaN(arg)) return {
                    content: locale._(message.locale,"global.arg.NaN", [author])
                };

                //Если пользователь не подключен к голосовым каналам
                else if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                //Если аргумент больше кол-ва треков
                if (arg > queue.songs.length && arg < queue.songs.length) return {
                    content: locale._(message.locale,"command.control.remove.arg", [author, queue.songs.size]),
                    color: "Yellow"
                };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) return {
                    content: locale._(message.locale,"player.played.not", [author]),
                    color: "Yellow"
                };

                let {title} = queue.songs[arg - 1];

                //Удаляем трек указанный пользователем
                if (arg !== 1) queue.songs.splice(arg - 1, 1);
                else {
                    //Удаляем первый трек
                    if (queue.repeat !== "off") queue.songs.splice(0, 1);
                    queue.player.stop();
                }

                //Сообщаем какой трек был убран
                return {
                    content: locale._(message.locale,"command.control.remove.song", [title]),
                    codeBlock: "css",
                    color: "Green"
                };
            }
        });
    };
}

/**
 * @class Command_Replay
 * @command remove
 * @description Пропуск трека по номеру
 *
 * @param value - Номер пропускаемого трека
 */
class Command_Replay extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("replay")
                .setDescription("Повторить текущий трек?")
                .setDescriptionLocale({
                    "en-US": "Repeat current track?"
                }).json,
            execute: ({message}) => {
                const { author, member, guild } = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: locale._(message.locale,"player.voice.inactive", [author]),
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: locale._(message.locale,"player.voice.active", [author, queue.voice.id]),
                    color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return {
                    content: locale._(message.locale,"player.queue.null", [author]),
                    color: "Yellow"
                };

                let { title } = queue.songs.song;

                queue.player.play(queue.songs.song);
                //Сообщаем о том что музыка начата с начала
                return { content: locale._(message.locale, "command.control.replay", [title]), color: "Green", codeBlock: "css" };
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Pause, Command_Resume, Command_Stop, Command_Repeat, Command_Skip, Command_Remove, Command_Replay});