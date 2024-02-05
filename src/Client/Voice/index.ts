import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ActionMessage, IActionMessage} from "@handler";
import {ArrayQueue} from "@Client/Voice/Queue/Queue";
import {Song} from "@Client/Voice/Queue/Song";
import {db} from "@Client/db";
/**
 * @author SNIPPIK
 * @description База сообщений
 * @type arrayMessages
 */
const arrayMessages: PlayerMessage.array<any>[] = [
    {
        type: "pushSong",
        callback: (queue: ArrayQueue) => {
            const {color, author, image, title, url, duration, requester} = queue.songs.last;

            return {
                message: queue.message, replied: true, time: 12e3,
                embeds: [
                    {
                        color, thumbnail: image.track,
                        author: {name: author.title, iconURL: db.emojis.diskImage, url: author.url},
                        footer: {
                            text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                            iconURL: requester.avatarURL()
                        },


                        fields: [
                            {
                                name: "**Новый трек в очереди**",
                                value: `**❯** **[${title}](${url}})\n**❯** \`\`${duration.full}\`\`**`
                            }
                        ]
                    }
                ]
            }
        }
    } as PlayerMessage.array<"pushSong">,
    {
        type: "pushPlaylist",
        callback: (message: ClientMessage, playlist: Song.playlist) => {
            const {author, image, url, title, items} = playlist;

            return {
                message, replied: true, time: 12e3,
                embeds: [
                    {
                        color: Colors.Blue, timestamp: new Date(),
                        author: {name: author?.title, url: author?.url, iconURL: db.emojis.diskImage},
                        thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.emojis.noImage},

                        footer: {
                            text: `${message.author.username} | ${Duration.getTimeArray(items)} | 🎶: ${items?.length}`,
                            iconURL: message.author.displayAvatarURL({})
                        },
                        fields: [
                            {
                                name: `**Найден плейлист**`,
                                value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${items.length}**`
                            }
                        ]
                    }
                ]
            };
        }
    } as PlayerMessage.array<"pushPlaylist">,
    {
        type: "playing",
        callback: (queue: ArrayQueue) => {
            const {color, author, image, requester, title, url, duration} = queue.songs.song;

            //Делаем заготовку для progress bar'а
            const currentTime = queue.player?.stream?.duration ?? 0;
            const progress = `\`\`${Duration.parseDuration(currentTime)}\`\` ${new ProgressBar(currentTime, duration.seconds).bar} \`\`${duration.full}\`\``;
            const fields = [
                {
                    name: `**Сейчас играет**`,
                    value: `**❯** **[${title}](${url})**\n${progress}`
                }
            ];

            //Следующий трек
            if (queue.songs.size > 1) {
                const song = queue.songs[1];
                fields.push({name: `**Следующий трек**`, value: `**❯** **[${song.title}](${song.url})**`});
            }
            const embed = {
                color, thumbnail: image.track, fields,
                author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                footer: {
                    text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                    iconURL: requester.avatarURL()
                }
            }

            return {
                message: queue.message, embeds: [embed], time: 0, replied: true,
                components: [queue.components as any],
                promise: (msg: ClientMessage) => {
                    db.queue.cycles.messages.push(msg);
                }
            }
        }
    } as PlayerMessage.array<"playing">,
    {
        type: "error",
        callback: (queue: ArrayQueue, error: string | Error) => {
            const {color, author, image, title, url, requester} = queue.songs.song;

            return {
                message: queue.message, replied: true, time: 10e3,
                embeds: [
                    {
                        color, thumbnail: image.track, timestamp: new Date(),
                        description: `\n[${title}](${url})\n\`\`\`js\n${error}...\`\`\``,
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        footer: {
                            text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                            iconURL: requester?.avatarURL()
                        }
                    }
                ]
            }
        }
    } as PlayerMessage.array<"error">,
    {
        type: "search",
        callback: (tracks: Song[], platform: string, message: ClientMessage) => {
            if (tracks?.length < 1 || !tracks) return void (new ActionMessage({
                content: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`,
                color: "DarkRed", message, replied: true
            }));

            return {
                replied: true, time: 30e3, message,
                //Сообщение
                embeds: [{
                    color: Colors.White, timestamp: new Date(),
                    author: {name: message.guild.name, iconURL: db.emojis.diskImage},
                    title: "Вот что мне удалось найти!"
                }],

                //Треки под сообщением
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

                        if (id && id !== "stop") {
                            //Ищем команду и выполняем ее
                            const command = db.commands.get("play").execute(message, [platform, id]);
                            if (command) {
                                if ((command instanceof Promise)) command.then((d) => new ActionMessage({...d, message}));
                                else new ActionMessage({...command, message});
                            }
                        }

                        interaction?.deferReply();
                        interaction?.deleteReply();

                        //Удаляем данные
                        ActionMessage.delete = {message: msg};
                        collector.stop();
                    });
                }
            }
        }
    } as PlayerMessage.array<"search">
]

/**
 * @author SNIPPIK
 * @description Управление временем
 * @class Duration
 */
export const Duration = new class {
    /**
     * @description Получаем случайное число
     * @param min {number} Мин число
     * @param max {number} Макс число
     */
    public randomNumber = (min: number = 0, max: number) => parseInt((Math.random() * (max - min) + min).toFixed(0));


    /**
     * @description Совмещаем время всех треков из очереди
     * @param songs {Song[] | Song.track[]} Очередь
     */
    public getTimeArray = (songs: Song[]): string => {
        //Если трек треков
        if (songs.length === 0) return "00:00";

        let time = 0;
        for (let i = 0; i < songs.length; i++) time += songs[i].duration.seconds;

        return this.parseDuration(time);
    };


    /**
     * @description Добавляем 0 к числу. Пример: 01:10
     * @param duration {string | number} Число
     * @return string | number
     */
    public toSplit = (duration: string | number): string | number => {
        const fixed = parseInt(duration as string);

        return (fixed < 10) ? ("0" + fixed) : fixed;
    };


    /**
     * @description Превращаем число в 00:00
     * @param duration {number} Время в int
     * @return string
     */
    public parseDuration = (duration: number): string => {
        const days = this.toSplit(duration / ((60 * 60) * 24) % 24) as number;
        const hours = this.toSplit(duration / (60 * 60) % 24) as number;
        const minutes = this.toSplit((duration / 60) % 60) as number;
        const seconds = this.toSplit(duration % 60) as number;

        return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
    };


    /**
     * @description Превращаем 00:00 в число
     * @param duration {string} Время в формате 00:00
     * @return number
     */
    public parseDurationString = (duration: string): number => {
        const time = duration?.split(":").map((value) => parseInt(value)) ?? [parseInt(duration)];

        switch (time.length) {
            case 4: return (time[0] * ((60 * 60) * 24)) + (time[1] * ((60 * 60) * 24)) + (time[2] * 60) + time[3];
            case 3: return (time[0] * ((60 * 60) * 24)) + (time[1] * 60) + time[2];
            case 2: return (time[0] * 60) + time[1];
            default: return time[0];
        }
    };
}

/**
 * @description Отправка сообщений плеера
 */
//@ts-ignore
export function getPlayerMessage<T = PlayerMessage.name>(type: PlayerMessage.name, args: PlayerMessage.args[T]) {
    const arrayData: PlayerMessage.array<T> = arrayMessages.find((item: PlayerMessage.array<T>) => item.type === type);

    if (!arrayData) throw TypeError("Not found embed message!");

    return arrayData.callback(...args as any);
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
 * @description Превращаем Array в Array<Array>
 * @param number {number} Сколько блоков будет в Array
 * @param array {Array} Сам Array
 * @param callback {Function} Как фильтровать
 * @param joined {string} Что добавить в конце
 */
export function ArraySort<V>(number: number = 5, array: V[], callback: (value: V, index?: number) => string, joined: string = "\n\n"): string[] {
    const pages: string[] = [];
    const lists = Array(Math.ceil(array.length / number)).fill(array[0]).map((_, i) => array.slice(i * number, i * number + number));

    for (const list of lists) {
        const text = list.map((value, index) => callback(value, index)).join(joined);

        if (text !== undefined) pages.push(text);
    }

    return pages;
}


/**
 *  _____           _                    __
 * |_   _|         | |                  / _|
 *   | |    _ __   | |_    ___   _ __  | |_    __ _   ___    ___   ___
 *   | |   | '_ \  | __|  / _ \ | '__| |  _|  / _` | / __|  / _ \ / __|
 *  _| |_  | | | | | |_  |  __/ | |    | |   | (_| | \__ \ |  __/ \__ \
 * |_____| |_| |_|  \__|  \___| |_|    |_|    \__,_| |___/  \___| |___/
 */


/**
 * @author SNIPPIK
 * @description Данные которые нужны для отправки сообщений
 */
namespace PlayerMessage {
    /**
     * @description Типы сообщений
     */
    export type name = "pushSong" | "pushPlaylist" | "playing" | "error" | "search";

    /**
     * @description Аргументы для сообщений
     */
    export interface args {
        search: [tracks: Song[], platform: string, message: ClientMessage];
        pushPlaylist: [message: ClientMessage, playlist: Song.playlist];
        error: [queue: ArrayQueue, error: string | Error];
        pushSong: [queue: ArrayQueue];
        playing: [queue: ArrayQueue];
    }

    /**
     * @description Получаем аргументы для вызова функции
     */
    export interface array<V> {
        type: V,
        //@ts-ignore
        callback: (...args:PlayerMessageArgs[V]) => IActionMessage
    }
}