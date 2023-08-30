import {Queue} from "@AudioPlayer/Queue/Queue";
import {ISong} from "@AudioPlayer/Queue/Song";
import {ClientMessage} from "@Client/Message";
import {Colors, EmbedData} from "discord.js";
import {Duration} from "@Util/Duration";
import {APIs} from "@APIs";
import {env} from "@env";

const note = env.get("music.note");
const Bar = {
    enable: env.get("bar"),
    full: env.get("bar.full"),
    empty: env.get("bar.empty"),

    button: env.get("bar.button")
}

export class Embed {
    private readonly _queue: Queue;
    protected get queue() { return this._queue; }
    public constructor(queue: Queue) { this._queue = queue; };

    /**
     * @description Обрезает текст до необходимых значений
     * @param text {string} Текст который надо изменить
     * @param value {number} До скольки символов надо обрезать текст
     * @param clearText {boolean} Надо ли очистить
     */
    protected readonly fixText = (text: string, value: number | any, clearText: boolean = false): string => {
        try {
            if (clearText) text = text.replace(/[\[,\]}{"`'*()]/gi, "");
            if (text.length > value && value !== false) return `${text.substring(0, value)}`;
            return text;
        } catch { return text; }
    };
}

export const PlayersEmbeds = {
    "toPlay": class extends Embed {
        public constructor(queue: Queue) { super(queue); };

        /**
         * @description Получаем EmbedData
         */
        public get toJson(): EmbedData {
            const { color, author, image, requester } = this.queue.song;
            const AuthorSong = this.fixText(author.title, 45, false);

            return {
                color, image: image.track, thumbnail: image.author, fields: this.getFields,
                author: { name: AuthorSong, url: author.url, iconURL: note },
                footer: { text: `${requester.username} | ${Duration.getTimeArray(this.queue.songs)} | 🎶: ${this.queue.songs.length}`, iconURL: requester.avatarURL() }
            };
        };


        /**
         * @description Создаем Message<Fields>
         */
        private get getFields(): EmbedData["fields"] {
            const { songs, song } = this.queue;

            //Текущий трек
            const fields = [{ name: `**Сейчас играет**`, value: `**❯** **[${this.fixText(song.title, 29, true)}](${song.url})**\n${this.toString}` }];

            //Следующий трек
            if (songs.length > 1) fields.push({ name: `**Следующий трек**`, value: `**❯** **[${this.fixText(songs[1].title, 29, true)}](${songs[1].url})**` });
            return fields;
        };


        /**
         * @description Получаем время трека для embed сообщения
         */
        private get toString(): string {
            const {duration} = this.queue.song;
            const streamDuration = this.queue.player.duration;

            if (duration.full === "Live" || !Bar.enable) return `\`\`[${duration.full}]\`\``;

            const parsedDuration = Duration.parseDuration(streamDuration);
            const progress = this.matchBar(streamDuration, duration.seconds);
            const string = `**❯** \`\`[${parsedDuration} \\ ${duration.full}]\`\``;

            return `${string}\n\`\`${progress}\`\``;
        };


        /**
         * @description Вычисляем прогресс бар
         * @param currentTime {number} Текущие время
         * @param maxTime {number} Макс времени
         * @param size {number} Кол-во символов
         */
        private matchBar = (currentTime: number, maxTime: number, size: number = 25): string => {
            try {
                const CurrentDuration = isNaN(currentTime) ? 0 : currentTime;
                const progressSize = Math.round(size * (CurrentDuration / maxTime));
                const progressText = Bar.full.repeat(progressSize);
                const emptyText = Bar.empty.repeat(size - progressSize);

                return `${progressText}${Bar.button}${emptyText}`;
            } catch (err) {
                if (err === "RangeError: Invalid count value") return "Error value";
                return "Loading...";
            }
        };
    },
    "toPush": class extends Embed {
        public constructor(queue: Queue) { super(queue); };

        /**
         * @description Получаем EmbedData
         */
        public get toJson(): EmbedData {
            const { color, author, image, title, url, duration, requester } = this.queue.songs.at(-1);
            const AuthorSong = this.fixText(author.title, 45, false);
            const fields = [{ name: "**Добавлено в очередь**", value: `**❯** **[${this.fixText(title, 40, true)}](${url}})\n**❯** \`\`[${duration.full}]\`\`**` }];

            return {
                color, fields, thumbnail: image.track,
                author: { name: AuthorSong, iconURL: image.author.url, url: author.url },
                footer: { text: `${requester.username} | ${Duration.getTimeArray(this.queue.songs)} | 🎶: ${this.queue.songs.length}`, iconURL: requester.avatarURL() }
            };
        };
    },
    "toPushPlaylist": class extends Embed {
        private readonly _playlist: ISong.playlist;
        private readonly _author: ClientMessage["author"];
        public constructor(playlist: ISong.playlist, author: ClientMessage["author"]) { super(null); this._playlist = playlist; this._author = author; };

        /**
         * @description Получаем EmbedData
         */
        public get toJson(): EmbedData {
            const { author, image, url, title, items } = this._playlist;

            return {
                color: Colors.Blue, timestamp: new Date(),
                author: { name: author?.title, url: author?.url },
                thumbnail: { url: author?.image?.url ?? note },
                image: typeof image === "string" ? { url: image } : image ?? { url: note },
                fields: [{ name: `**Найден плейлист**`, value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${items.length}**` }],
                footer: { text: `${this._author.username} | ${Duration.getTimeArray(items)} | 🎶: ${items?.length}`, iconURL: this._author.displayAvatarURL({}) }
            };
        };
    },
    "toError": class extends Embed {
        private readonly _error: string | Error;
        public constructor(queue: Queue, error: string | Error) { super(queue); this._error = error};

        /**
         * @description Получаем EmbedData
         */
        public get toJson(): EmbedData {
            const { color, author, image, title, url, requester } = this.queue.song;
            const songs = this.queue.songs;
            const AuthorSong = this.fixText(author.title, 45, false);

            return {
                color, thumbnail: image.track, timestamp: new Date(),
                description: `\n[${title}](${url})\n\`\`\`js\n${this._error}...\`\`\``,
                author: { name: AuthorSong, url: author.url, iconURL: image.author.url },
                footer: { text: `${requester.username} | ${Duration.getTimeArray(songs)} | 🎶: ${songs.length}`, iconURL: requester?.avatarURL() }
            };
        };
    },
    "toSearch": class extends Embed {
        private readonly _platform: string;
        public constructor(platform: string) { super(null); this._platform = platform};

        /**
         * @description Получаем EmbedData
         */
        public get toJson(): EmbedData {
            return {
                color: new APIs(this._platform).color,
                title: `Необходимо выбрать трек!`,
                timestamp: new Date(),
            };
        };
    }
}