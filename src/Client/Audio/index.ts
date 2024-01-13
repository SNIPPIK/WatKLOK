import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Collection} from "@Client/Audio/Queue/Collection";
import {Filter} from "@Client/Audio/Player/AudioResource";
import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {Song} from "@Client/Audio/Queue/Song";
import {httpsClient} from "@Client/Request";
import {ActionMessage} from "@Client";
import {API} from "@handler/APIs";
import {env} from "@env";
import {db} from "@src";
import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
/**
 * @author SNIPPIK
 * @description Все данные относящиеся к музыке
 * @class db_Music
 * @private
 */
export class db_Music {
    private readonly _queue = new Collection();
    private readonly _filters: Filter[] = [];
    private readonly _platform = {
        supported: [] as API.load[],
        authorization: [] as API.platform[],
        audio: [] as API.platform[],
        block: [] as API.platform[]
    };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._platform; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this._queue; };

    /**
     * @description Получаем фильтры полученные из базы данных github
     * @return Filter[]
     * @public
     */
    public get filters() { return this._filters; };

    /**
     * @description Получаем фильтры из базы данных WatKLOK
     * @return Promise<Error | true>
     * @public
     */
    public get gettingFilters(): Promise<Error | true> {
        return new Promise<Error | true>(async (resolve, reject) => {
            const raw = await new httpsClient(env.get("filters.url"), {useragent: true}).toJson;

            if (raw instanceof Error) return reject(raw);
            this._filters.push(...raw);

            return resolve(true);
        });
    };
}


/**
 * @author SNIPPIK
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
 * @author SNIPPIK
 * @description Локальная база
 */
const local_db = {
    ne_center: env.get("progress.not_empty.center"),
    ne_left: env.get("progress.not_empty.left"),
    ne_right: env.get("progress.not_empty.right"),
    bottom: env.get("progress.bottom"),
    e_center: env.get("progress.empty.center"),
    e_left: env.get("progress.empty.left"),
    e_right: env.get("progress.empty.right"),

    not_image: env.get("image.not"),
    image_disk: env.get("image.currentPlay")
};

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class ProgressBar
 */
class ProgressBar {
    private readonly _current: number;
    private readonly _max: number;
    private readonly _size: number = 12;
    /**
     * @description Высчитываем прогресс бар
     */
    public get bar(): string {
        const size = this._size, current = this._current, max = this._max;
        const progressZ = Math.round(size * (isNaN(current) ? 0 : current / max));
        let progress: string = "";

        //Начало показа дорожки
        if (current > 0) progress += `${local_db.ne_left}`;
        else progress += `${local_db.e_left}`;

        //Середина дорожки + точка
        if (current === 0) progress += `${local_db.ne_center.repeat(progressZ)}${local_db.e_center.repeat((size + 1) - progressZ)}`;
        else if (current >= max) progress += `${local_db.ne_center.repeat(size)}`;
        else progress += `${local_db.ne_center.repeat(progressZ)}${local_db.bottom}${local_db.e_center.repeat(size - progressZ)}`;

        //Конец дорожки
        if (current >= max) progress += `${local_db.ne_right}`;
        else progress += `${local_db.e_right}`

        return progress;
    };

    public constructor(currentDur: number, max: number) {
        if (currentDur > max) this._current = max;
        else this._current = currentDur;

        this._max = max;
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


export function toPlay(queue: ArrayQueue, isVoid = true) {
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
        author: {name: author.title, url: author.url, iconURL: local_db.image_disk},
        footer: {
            text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
            iconURL: requester.avatarURL()
        }
    }

    //если надо отредактировать сообщение о текущем треке
    if (!isVoid) return embed;

    new ActionMessage({
        message: queue.message, embeds: [embed], time: 0, replied: true,
        components: [queue.components as any],
        promise: (msg: ClientMessage) => {
            db.music.queue.cycles.messages.push(msg);
        }
    });
}

export function toPush (queue: ArrayQueue) {
    const {color, author, image, title, url, duration, requester} = queue.songs.last;

    new ActionMessage({
        message: queue.message, replied: true, time: 12e3,
        embeds: [
            {
                color, thumbnail: image.track,
                author: {name: author.title, iconURL: local_db.image_disk, url: author.url},
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
    });
}

export function toError (queue: ArrayQueue, error: string | Error) {
    const {color, author, image, title, url, requester} = queue.songs.song;

    new ActionMessage({
        message: queue.message, replied: true, time: 10e3,
        embeds: [
            {
                color, thumbnail: image.track, timestamp: new Date(),
                description: `\n[${title}](${url})\n\`\`\`js\n${error}...\`\`\``,
                author: {name: author.title, url: author.url, iconURL: local_db.image_disk},
                footer: {
                    text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                    iconURL: requester?.avatarURL()
                }
            }
        ]
    });
}

export function toPushPlaylist (message: ClientMessage, playlist: Song.playlist) {
    const {author, image, url, title, items} = playlist;

    new ActionMessage({
        message, replied: true, time: 12e3,
        embeds: [
            {
                color: Colors.Blue, timestamp: new Date(),
                author: {name: author?.title, url: author?.url, iconURL: local_db.image_disk},
                thumbnail: typeof image === "string" ? {url: image} : image ?? {url: local_db.not_image},

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
    });
}

export function toSearch (tracks: Song[], platform: string, message: ClientMessage) {
    if (tracks?.length < 1 || !tracks) return void (new ActionMessage({
        content: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`,
        color: "DarkRed", message, replied: true
    }));

    new ActionMessage({
        replied: true, time: 30e3, message,
        //Сообщение
        embeds: [{
            color: Colors.White, timestamp: new Date(),
            author: {name: message.guild.name, iconURL: local_db.image_disk},
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
    });
}