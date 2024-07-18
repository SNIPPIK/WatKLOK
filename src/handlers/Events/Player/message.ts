import {LightMessageBuilder, MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import interactionCreate from "@handler/Events/Client/interactionCreate";
import {API, Constructor, Handler} from "@handler";
import {Queue} from "@lib/voice/player/queue/Queue";
import {Song} from "@lib/voice/player/queue/Song";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @class onError
 * @event message/error
 * @description Сообщение об ошибке
 */
class onError extends Constructor.Assign<Handler.Event<"message/error">> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            execute: (queue, error) => {
                //Если больше нет треков в очереди
                if (queue.songs.size < 1) return;

                const {color, author, image, title, requester} = queue.songs.last;
                new MessageBuilder().addEmbeds([
                    {
                        color, thumbnail: image, timestamp: new Date(),
                        fields: [
                            {
                                name: locale._(queue.message.locale,"player.message.playing.current"),
                                value: `\`\`\`${title}\`\`\``
                            },
                            {
                                name: `**Error:**`,
                                value: `\`\`\`js\n${error}...\`\`\``
                            }
                        ],
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        footer: {
                            text: `${requester.username} | ${queue.songs.time()} | 🎶: ${queue.songs.size}`,
                            iconURL: requester?.avatar
                        }
                    }
                ]).setTime(10e3)
                    .send = queue.message as any;
            }
        });
    }
}

/**
 * @author SNIPPIK
 * @class onPush
 * @event message/push
 * @description Сообщение о добавленном треке или плейлисте
 */
class onPush extends Constructor.Assign<Handler.Event<"message/push">> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            execute: (queue, obj) => {

                //Если был добавлен трек
                if (queue instanceof Queue.Music) {
                    const {color, author, image, title, duration} = obj as Song;

                    new MessageBuilder().addEmbeds([
                        {
                            color, thumbnail: image,
                            author: author ? {
                                name: author?.title,
                                iconURL: db.emojis.diskImage,
                                url: author?.url
                            } : null,
                            footer: {
                                text: `${duration.full} | 🎶: ${queue.songs.size}`
                            },
                            fields: [
                                {
                                    name: locale._(queue.message.locale,"player.message.push.track"),
                                    value: `\`\`\`${title}\`\`\`\ `
                                }
                            ]
                        }
                    ]).setTime(12e3).setReplied(true)
                        .send = queue.message;
                }

                //Если был добавлен плейлист
                else if ("items" in obj) {
                    const {author, image, title, items} = obj;

                    new MessageBuilder().addEmbeds([
                        {
                            color: Colors.Blue, timestamp: new Date(),
                            author: {name: author?.title, url: author?.url, iconURL: db.emojis.diskImage},
                            thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.emojis.noImage},

                            footer: {
                                text: `${queue.author.username} | ${items.time()} | 🎶: ${items?.length}`,
                                iconURL: queue.author.displayAvatarURL({})
                            },
                            fields: [
                                {
                                    name: locale._(queue.locale,"player.message.push.list"),
                                    value: `\`\`\`${title}\`\`\`\ `
                                }
                            ]
                        }
                    ]).setTime(20e3).setReplied(true)
                        .send = queue;
                }
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @class onSearch
 * @event message/search
 * @description Сообщение с выбором трека
 */
class onSearch extends Constructor.Assign<Handler.Event<"message/search">> {
    public constructor() {
        super({
            name: "message/search",
            type: "player",
            execute: (tracks, platform, message) => {
                if (tracks?.length < 1 || !tracks) {
                    new LightMessageBuilder({
                        content: locale._(message.locale,"player.message.search.fail", [message.author]),
                        color: "DarkRed"
                    }).send = message;
                }

                new MessageBuilder().addEmbeds([{description: locale._(message.locale,"player.message.search.ok")}]).setTime(30e3)
                    .addComponents([new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("menu-builder")
                        .setOptions(...tracks.map((track) => {
                                return {
                                    label: `${track.title}`,
                                    description: `${track.author.title} | ${track.duration.full}`,
                                    value: track.url
                                }
                            }), {label: locale._(message.locale,"cancel"), value: "stop"}
                        )
                    )]).setReplied(true)
                    .setPromise((msg) => {
                        //Создаем сборщик
                        const collector = msg.createMessageComponentCollector({
                            filter: (interaction) => !interaction.user.bot,
                            time: 30e3,
                            max: 1
                        });

                        //Что будет делать сборщик после выбора трека
                        collector.once("collect", (interaction: any) => {
                            const id = interaction.values[0];

                            if (id && id !== "stop") db.audio.queue.events.emit("collection/api", message, message.member.voice.channel, [platform, id])

                            interaction?.deferReply();
                            interaction?.deleteReply();

                            //Удаляем данные
                            MessageBuilder.delete = {message: msg};
                            collector.stop();
                        });
                    }).send = message;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @class onPlaying
 * @event message/playing
 * @description Сообщение о том что сейчас играет
 */
class onPlaying extends Constructor.Assign<Handler.Event<"message/playing">> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            execute: (queue, isReturn) => {
                const {color, author, image, title, url, duration, platform} = queue.songs.song;
                const embed = new MessageBuilder().addEmbeds([
                    {
                        color, thumbnail: image,
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        fields: [
                            {
                                name: locale._(queue.message.locale,"player.message.playing.current"),
                                value: `\`\`\`${title}\`\`\``
                            },

                            //Следующий трек или треки
                            queue.songs.size > 1 ? (() => {
                                const tracks = queue.songs.slice(1, 5).map((track, index) => {
                                    return `\`${index + 2}\` ${track.titleReplaced}`;
                                });

                                if (queue.songs.size > 5) return {
                                    name: locale._(queue.message.locale,"player.message.playing.next.alt", [queue.songs.size]),
                                    value: tracks.join("\n")
                                };
                                return {name: locale._(queue.message.locale,"player.message.playing.next"), value: tracks.join("\n")};
                            })() : null,

                            {
                                name: "",
                                value: (() => {
                                    const current = queue.player?.stream?.duration ?? 0;
                                    const progress = new PlayerProgress({ platform,
                                        duration: { current,
                                            total: duration.seconds
                                        }
                                    });

                                    return `\n[|](${url})\`\`${current.duration()}\`\` ${progress.bar} \`\`${duration.full}\`\``;
                                })()
                            }
                        ]
                    }
                ]).setReplied(true).setPromise((msg) => {
                    if (!db.audio.cycles.messages.array.includes(msg)) db.audio.cycles.messages.set(msg);

                    //Создаем сборщик
                    const collector = msg.createMessageComponentCollector({
                        filter: (interaction) => !interaction.user.bot
                    });

                    //Собираем кнопки нажатые пользователями
                    collector.on("collect", (message: any) => {
                        const item = (() => {
                            switch (message.customId) {
                                //Кнопка назад
                                case "last": {
                                    if (queue.songs.size < 2)
                                        return {
                                            content: locale._(message.locale, "InteractionCreate.button.arg", [author]),
                                            color: "Yellow"
                                        };
                                    else if (queue.songs.length > 1) {
                                        const index = 0 ?? queue.songs.length - 1;
                                        queue.songs[0] = queue.songs[index];
                                        queue.songs[index] = queue.songs.song;
                                    }
                                    queue.player.stop();
                                    return {
                                        content: locale._(message.locale, "InteractionCreate.button.last", [author]),
                                        color: "Green"
                                    };
                                }

                                //Кнопка случайного трека
                                case "shuffle": {
                                    if (queue.songs.size < 2)
                                        return {
                                            content: locale._(message.locale, "InteractionCreate.button.arg", [author]),
                                            color: "Yellow"
                                        };
                                    queue.shuffle = !queue.shuffle;
                                    return {
                                        content: locale._(message.locale, "InteractionCreate.button.shuffle", [author, queue.shuffle ? locale._(message.locale, "on") : locale._(message.locale, "off")]),
                                        color: "Green"
                                    };
                                }

                                //Кнопка пропуска
                                case "skip":
                                    return db.commands.get("skip").execute({ message, args: ["1"] });

                                //Кнопка повтора
                                case "repeat": {
                                    const loop = queue.repeat;
                                    if (loop === "off") {
                                        queue.repeat = "songs";
                                        return {
                                            content: locale._(message.locale, "command.control.repeat.all"),
                                            codeBlock: "css"
                                        };
                                    }
                                    else if (loop === "songs") {
                                        queue.repeat = "song";
                                        return {
                                            content: locale._(message.locale, "command.control.repeat.one", [queue.songs.song.title]),
                                            codeBlock: "css"
                                        };
                                    }
                                    queue.repeat = "off";
                                    return {
                                        content: locale._(message.locale, "command.control.repeat.off"),
                                        codeBlock: "css"
                                    };
                                }

                                //Кнопка паузы и продолжения
                                case "resume_pause": {
                                    if (queue.player.status === "player/playing")
                                        return db.commands.get("pause").execute({ message });
                                    else if (queue.player.status === "player/pause")
                                        return db.commands.get("resume").execute({ message });
                                    return {
                                        content: locale._(message.locale, "player.wait", [author]),
                                        color: "Yellow"
                                    };
                                }
                            }
                        })();
                        interactionCreate[0]["_stepMessage"](item as any, message)
                    });
                });

                //Если надо отдать embed
                if (isReturn) return embed.embeds.pop();
                embed.setTime(0).addComponents([queue.components as any]).send = queue.message;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class PlayerProgress
 */
class PlayerProgress {
    private static emoji: typeof db.emojis.progress = null;
    private readonly size = 12;
    private readonly options = {
        platform: null as API.platform,
        duration: {
            current: 0 as number,
            total: 0 as number
        }
    };

    private get duration() {
        return this.options.duration;
    };

    private get emoji() {
        if (!PlayerProgress.emoji) PlayerProgress.emoji = db.emojis.progress;
        return PlayerProgress.emoji;
    };

    private get platform() {
        return this.options.platform.toLowerCase();
    };

    private get bottom() {
        return this.emoji["bottom_" + this.platform.toLowerCase()] || this.emoji.bottom;
    };

    public get bar() {
        const size =  this.size, {current, total} = this.duration, emoji = this.emoji;
        const number = Math.round(size * (isNaN(current) ? 0 : current / total));
        let txt = current > 0 ? `${emoji.upped.left}` : `${emoji.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) txt += `${emoji.upped.center.repeat(number)}${emoji.empty.center.repeat((size + 1) - number)}`;
        else if (current >= total) txt += `${emoji.upped.center.repeat(size)}`;
        else txt += `${emoji.upped.center.repeat(number)}${this.bottom}${emoji.empty.center.repeat(size - number)}`;

        return txt + (current >= total ? `${emoji.upped.right}` : `${emoji.empty.right}`);
    };

    public constructor(options: PlayerProgress["options"]) {
        Object.assign(this.options, options);
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onPlaying, onError, onSearch, onPush});