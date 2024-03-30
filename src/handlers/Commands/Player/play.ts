import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            name: "player",
            description: "Взаимодействия с плеером",
            permissions: ["Speak", "Connect"],

            options: [
                {
                    name: "play",
                    description: "Включение музыки по ссылке или названию!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "select",
                            description: "К какой платформе относится запрос?",
                            type: ApplicationCommandOptionType["String"],
                            required: true,
                            choices: db.api.allow.map((platform) => {
                                return {
                                    name: `[${platform.requests.length}] ${platform.url} | ${platform.name}`,
                                    value: platform.name
                                }
                            })
                        },
                        {
                            name: "request",
                            description: "Необходимо указать ссылку или название трека!",
                            required: true,
                            type: ApplicationCommandOptionType["String"]
                        }
                    ],
                },
                {
                    name: "file",
                    description: "Включение музыки с использованием файла!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "input",
                            description: "Необходимо прикрепить файл!",
                            type: ApplicationCommandOptionType["Attachment"],
                            required: true
                        }
                    ]
                },

                //Group Control
                {
                    name: "control",
                    description: "any",
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    options: [
                        {
                            name: "replay",
                            description: "Повторить текущий трек?",
                            type: ApplicationCommandOptionType.Subcommand
                        },
                        {
                            name: "seek",
                            description: "Пропуск времени в текущем треке!",
                            type: ApplicationCommandOptionType.Subcommand,
                            options: [
                                {
                                    name: "value",
                                    description: "Пример - 00:00",
                                    required: true,
                                    type: ApplicationCommandOptionType["String"]
                                }
                            ]

                        },
                        {
                            name: "pause",
                            description: "Приостановить воспроизведение текущего трека?!",
                            type: ApplicationCommandOptionType.Subcommand
                        },
                        {
                            name: "resume",
                            description: "Возобновить воспроизведение текущего трека?!",
                            type: ApplicationCommandOptionType.Subcommand
                        },
                        {
                            name: "stop",
                            description: "Выключение музыки",
                            type: ApplicationCommandOptionType.Subcommand
                        }
                    ]
                }
            ],

            execute: ({message, args, sub}) => {
                const {author, member, guild} = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: `${author} | Необходимо подключиться к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если пользователя пытается включить трек
                if (sub === "play") {
                    db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, args);
                    return;
                }

                //Если пользователь прикрепил файл
                else if (sub === "file") {
                    const attachment = (message as Client.interact).options.getAttachment("file");

                    //Если пользователь подсунул фальшивку
                    if (!attachment.contentType.match("audio")) return {
                        content: `${author} | В этом файле нет звуковой дорожки!`,
                        color: "Yellow"
                    };

                    db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, ["DISCORD", attachment]);
                    return;
                }

                //Если нет очереди
                if (!queue) return { content: `${author} | Музыка сейчас не играет.`, color: "Yellow" };

                switch (sub) {
                    case "seek": {
                        //Если текущий трек является потоковым
                        if (queue.songs.song.duration.seconds === 0) return { content: `${author} | А как? Это же стрим!`, color: "Yellow" };

                        //Если пользователь не указал время
                        else if (!args[0]) return { content: `${author} | Укажи время, пример 00:00:00!`, color: "Yellow" };

                        const duration = args[0].duration();

                        //Если пользователь написал что-то не так
                        if (isNaN(duration)) return { content: `${author} | Я не могу определить что ты написал, попробуй еще раз!`, color: "Yellow" };

                        //Если пользователь указал времени больше чем в треке
                        else if (duration > queue.songs.song.duration.seconds) return { content: `${author} | Ты указал слишком много времени!`, color: "Yellow" };

                        //Если музыку нельзя пропустить из-за плеера
                        else if (!queue.player.playing) return { content: `${author} | Музыка еще не играет!`, color: "Yellow" };

                        //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                        queue.player.play(queue.songs.song, duration);

                        //Отправляем сообщение о пропуске времени
                        return { content: `⏭️ | Seeking to [${args[0]}] song\n> ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
                    }
                    case "replay": {
                        let { title } = queue.songs.song;

                        queue.player.play(queue.songs.song);
                        //Сообщаем о том что музыка начата с начала
                        return { content: `🔂 | Replay | ${title}`, color: "Green", codeBlock: "css" };
                    }
                    case "pause": {
                        //Если музыка уже приостановлена
                        if (queue.player.status === "player/pause") return { content: `${author} | Музыка уже приостановлена!`, color: "Yellow" };

                        //Если текущий трек является потоковым
                        else if (queue.songs.song.duration.seconds === 0) return { content: `${author} | Это бесполезно!`, color: "Yellow" };

                        //Приостанавливаем музыку если она играет
                        queue.player.pause();
                        return { content: `⏸ | Pause song | ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
                    }
                    case "resume": {
                        //Если музыка уже играет
                        if (queue.player.status === "player/playing") return { content: `${author} | Музыка сейчас играет.`, color: "Yellow" };

                        //Если текущий трек является потоковым
                        else if (queue.songs.song.duration.seconds === 0) return { content: `${author} | Это бесполезно!`, color: "Yellow" };

                        let { title } = queue.songs.song;

                        queue.player.resume();
                        return { content: `▶️ | Resume song | ${title}`, codeBlock: "css", color: "Green" };
                    }

                    case "stop": {
                        db.audio.queue.remove(queue.guild.id);
                        return { content: `${author} | Музыкальная очередь удалена!` };
                    }
                }
            }
        })
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});