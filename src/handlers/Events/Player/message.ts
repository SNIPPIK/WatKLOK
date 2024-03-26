import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Queue} from "@lib/player/queue/Queue";
import {Song} from "@lib/player/queue/Song";
import {Client} from "@lib/discord";
import {db} from "@lib/db";

/**
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
                const {color, author, image, title, requester} = queue.songs.last;

                new Constructor.message<"embeds">({ message: queue.message, replied: true, time: 10e3,
                    embeds: [
                        {
                            color, thumbnail: image, timestamp: new Date(),
                            fields: [
                                {
                                    name: `**Играл:**`,
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
                    ]
                })
            }
        });
    }
}

/**
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
                const {color, author, image, title, url, duration} = queue.songs.song;
                const embed = {
                    color, thumbnail: image,
                    author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                    fields: [
                        {
                            name: `**Играет:**`,
                            value: `\`\`\`${title}\`\`\``
                        }
                    ]
                };

                //Следующий трек или треки
                if (queue.songs.size > 1) {
                    const tracks = queue.songs.slice(1, 5).map((track, index) => {
                        const title = `[${track.title.slice(0, 50)}](${track.url})`;

                        if (track.platform === "YOUTUBE") return `\`${index+2}.\` \`\`[${track.duration.full}]\`\` ${title}`;
                        return `\`${index+2}.\` \`\`[${track.duration.full}]\`\` [${track.author.title}](${track.author.url}) - ${title}`;
                    });

                    if (queue.songs.size > 5) embed.fields.push({ name: `**Следующее - ${queue.songs.size}**`, value: tracks.join("\n") });
                    else embed.fields.push({ name: `**Следующее: **`, value: tracks.join("\n") });
                }

                //Progress bar
                const currentTime = queue.player?.stream?.duration ?? 0;
                const progress = `\`\`${currentTime.duration()}\`\` ${new ProgressBar(currentTime, duration.seconds).bar} \`\`${duration.full}\`\``;
                embed.fields.push({ name: " ", value: `\n[|](${url})${progress}` });

                if (isReturn) return embed;

                //Создаем и отправляем сообщение
                new Constructor.message<"embeds">({
                    message: queue.message, embeds: [embed], time: 0, replied: true,
                    components: [queue.components as any],
                    promise: (msg: Client.message) =>  {
                        if (!db.queue.cycles.messages.array.includes(msg)) db.queue.cycles.messages.set(msg);
                    }
                });
            }
        });
    }
}

/**
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
                let options: any;

                //Если был добавлен трек
                if (queue instanceof Queue.Music) {
                    const {color, author, image, title, duration} = obj as Song;
                    options = { message: queue.message, replied: true, time: 12e3, embeds: [
                            {
                                color, thumbnail: image,
                                author: {name: author.title, iconURL: db.emojis.diskImage, url: author.url},
                                footer: {
                                    text: `${duration.full} | 🎶: ${queue.songs.size}`
                                },
                                fields: [
                                    {
                                        name: "**Добавлен трек:**",
                                        value: `\`\`\`${title}\`\`\`\ `
                                    }
                                ]
                            }
                        ]
                    }
                    //Если был добавлен плейлист
                } else if ("items" in obj) {
                    const {author, image, title, items} = obj;
                    options = { message: queue, replied: true, time: 20e3,
                        embeds: [
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
                                        name: `**Добавлен плейлист:**`,
                                        value: `\`\`\`${title}\`\`\`\ `
                                    }
                                ]
                            }
                        ]
                    }
                }

                //Создаем и отправляем сообщение
                new Constructor.message<"embeds">(options);
            }
        });
    }
}

/**
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
                if (tracks?.length < 1 || !tracks) return void (new Constructor.message<"simple">({
                    content: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`,
                    color: "DarkRed", message, replied: true
                }));

                new Constructor.message<"simple">({
                    replied: true, time: 30e3, message, content: "Вот что мне удалось найти!",
                    //Список треков под сообщением
                    components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("menu-builder").setPlaceholder("Найденные треки")
                        .setOptions(...tracks.map((track) => {
                                return {
                                    label: `${track.title}`,
                                    description: `${track.author.title} | ${track.duration.full}`,
                                    value: track.url
                                }
                            }), {label: "Отмена", value: "stop"}
                        )
                    )],

                    //Действия после сообщения
                    promise: (msg) => {
                        //Создаем сборщик
                        const collector = msg.createMessageComponentCollector({
                            filter: (interaction) => !interaction.user.bot,
                            time: 30e3,
                            max: 1
                        });

                        //Что будет делать сборщик после выбора трека
                        collector.once("collect", (interaction: any) => {
                            const id = interaction.values[0];

                            if (id && id !== "stop") db.queue.events.emit("collection/api", message, message.member.voice.channel, [platform, id])

                            interaction?.deferReply();
                            interaction?.deleteReply();

                            //Удаляем данные
                            Constructor.message.delete = {message: msg};
                            collector.stop();
                        });
                    }
                });
            }
        });
    }
}

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class ProgressBar
 */
class ProgressBar {
    private readonly _local = {
        current: 0,
        max:     0,
        size:    12
    };

    public constructor(currentDur: number, max: number) {
        if (currentDur > max) this._local.current = max;
        else this._local.current = currentDur;

        this._local.max = max;
    };

    /**
     * @description Высчитываем прогресс бар
     */
    public get bar(): string {
        const {progress} = db.emojis;
        const size =  this._local.size, current =  this._local.current, max =  this._local.max;
        const progressZ = Math.round(size * (isNaN(current) ? 0 : current / max));
        let bar: string = "";

        //Начало показа дорожки
        if (current > 0) bar += `${progress.upped.left}`;
        else bar += `${progress.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) bar += `${progress.upped.center.repeat(progressZ)}${progress.empty.center.repeat((size + 1) - progressZ)}`;
        else if (current >= max) bar += `${progress.upped.center.repeat(size)}`;
        else bar += `${progress.upped.center.repeat(progressZ)}${progress.bottom}${progress.empty.center.repeat(size - progressZ)}`;

        //Конец дорожки
        if (current >= max) bar += `${progress.upped.right}`;
        else bar += `${progress.empty.center}`;

        return bar;
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onPlaying, onError, onSearch, onPush});