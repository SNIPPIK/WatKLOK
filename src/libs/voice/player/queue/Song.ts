import {httpsClient} from "@lib/request";
import {API} from "@handler";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Все интерфейсы для работы системы треков
 * @namespace
 */
export namespace Song {
    /**
     * @description Какие данные доступны в <song>.requester
     * @interface
     */
    export interface requester {
        //ID Пользователя
        id: string;

        //Ник пользователя
        username: string;

        //Ссылка на аватар пользователя
        avatar: string | null;
    }

    /**
     * @description Пример получаемого трека
     * @interface
     */
    export interface track {
        //Название трека
        title: string;

        //Ссылка на трек
        url: string;

        //Картинка трека
        image: image;

        //Автор трека
        author: author,

        //Время
        duration: {
            //Длительность в секундах
            seconds: string;
        };

        //Исходный файл
        link?: string | null;
    }

    /**
     * @description Пример получаемого автора трека
     * @interface
     */
    export interface author {
        //Имя автора
        title: string;

        //Ссылка на автора
        url: string | undefined;
        image?: image;
    }

    /**
     * @description Пример получаемого плейлиста
     * @interface
     */
    export interface playlist {
        url: string;
        title: string;
        items: Song[];
        image: { url: string; };
        author?: author;
    }

    /**
     * @description Параметры картинки
     * @interface
     */
    export interface image {
        //Ссылка на картинку
        url: string;

        //Длина
        height?: number;

        //Высота
        width?: number
    }
}

/**
 * @author SNIPPIK
 * @class Song
 * @description Ключевой элемент музыки
 */
export class Song {
    private readonly _api: { platform: API.platform; color: number; } = null;
    private readonly _duration: { full: string; seconds: number; } = null;
    private readonly _track: Song.track & { requester?: Song.requester; duration?: { full: string; seconds: number; }} = {
        title: null, url: null, image: null, author: null, duration: null
    };
    public constructor(track: Song.track) {
        //Высчитываем время
        if (track.duration.seconds.match(/:/)) {
            this._duration = { full: track.duration.seconds, seconds: track.duration.seconds.duration() };
        } else {
            const seconds = parseInt(track.duration.seconds) || 321;

            //Время трека
            if (isNaN(seconds) || !seconds) this._duration = { full: "Live", seconds: 0 };
            else this._duration = { full: seconds.duration(), seconds };
        }

        const api = new API.response(track.url);

        //Изображения трека
        track["image"] = track?.image ?? { url: db.emojis.noImage };

        //Удаляем ненужные данные
        delete track.duration;

        //Добавляем данные
        Object.assign(this._track, track);
        this._api = {platform: api.platform, color: api.color };
    };
    /**
     * @description Получаем название трека
     * @public
     */
    public get title() {
        if (!this._track.title) return "null";
        return this._track.title;
    };
    /**
     * @description Получаем отредактированное название трека
     * @public
     */
    public get titleReplaced() {
        // Удаляем лишнее скобки
        const title = `[${this.title.replace(/[\(\)\[\]"]/g, "").substring(0, 45)}](${this.url})`;

        if (this.platform === "YOUTUBE") return `\`\`[${this.duration.full}]\`\` ${title}`;
        return `\`\`[${this.duration.full}]\`\` [${this.author.title}](${this.author.url}) - ${title}`;
    };
    /**
     * @description Получаем ссылку на трек
     * @public
     */
    public get url() { return this._track.url; };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get author() { return this._track.author; };

    /**
     * @description Получаем время трека
     * @public
     */
    public get duration() { return this._duration; };

    /**
     * @description Получаем картинки автора и трека
     * @public
     */
    public get image() { return this._track.image; };

    /**
     * @description Получаем пользователя который включил трек
     * @public
     */
    public get requester() { return this._track.requester; };
    public set requester(author) {
        const { username, id, avatar } = author;

        //Если нет автора трека, то автором станет сам пользователь
        if (!this.author) this._track.author = {
            title: username, url: `https://discordapp.com/users/${id}`
        };

        //Пользователь, который включил трек
        this._track.requester = {
            username, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };
    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() { return this._track.link; };
    public set link(url: string) { this._track.link = url; }

    /**
     * @description Получаем платформу у которого был взят трек
     * @public
     */
    public get platform() { return this._api.platform; };
    /**
     * @description Получаем цвет трека
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return string | Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        const platform = this.platform;
        const isDownload = db.cache.audio && platform !== "DISCORD";

        //Создаем обещание
        return new Promise(async (resolve) => {
            //Если трек уже кеширован, то сразу выдаем его
            if (isDownload) {
                const info = db.cache.audio.status(this);
                if (info.status === "final") return resolve(`file:|${info.path}`);
            }

            //Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
            for (let r = 0; r < 3; r++) {

                //Если нет ссылки, то ищем замену
                if (!this.link) {
                    const link = !db.api.platforms.audio.includes(this.platform) ? await fetchAPIs(this) : await fetchOther(this);

                    //Если вместо ссылки получили ошибку
                    if (link instanceof Error || !link) {
                        if (r < 3) continue;
                        else return resolve("Fail find other track, requested a max 3!");
                    }

                    this.link = link;
                }

                //Проверяем ссылку на актуальность
                if (this.link) {
                    try {
                        const status = await new httpsClient(this.link, {method: "HEAD"}).status;

                        if (status) break
                        else this.link = null;
                    } catch (err) {
                        Logger.log("ERROR", err);
                        this.link = null;
                    }
                }
            }

            //Если не удается найти ссылку через n попыток
            if (!this.link) return resolve(Error(`[SONG]: Fail update link resource`));
            else if (isDownload && this.link) void (db.cache.audio.set(this));
            return resolve(`link:|${this.link}`);
        });
    };
}

/**
 * @author SNIPPIK
 * @description Ищем аудио если платформа может самостоятельно выдать аудио
 * @param track - трек у которого нет аудио
 */
function fetchAPIs(track: Song): Promise<string | Error> {
    return new Promise(async (resolve) => {
        const api = new API.response(track.platform).find("track");

        //Если нет такого запроса
        if (!api) return resolve(Error(`[Song/${track.platform}]: not found callback for track`));

        try {
            const song = await api.callback(track.url, {audio: true});

            if (song instanceof Error) return resolve(song);
            return resolve(song.link);
        } catch (err) {
            return resolve(err);
        }
    });
}

/**
 * @author SNIPPIK
 * @description Получаем ссылку на трек если прошлая уже не актуальна
 * @param track - трек у которого нет аудио
 */
function fetchOther(track: Song): Promise<string | Error> {
    return new Promise(async (resolve) => {
        const platform = new API.response(db.api.platforms.supported.find((plt) => plt.requests.length >= 2 && plt.audio).name);

        try {
            const tracks = await platform.find("search").callback(`${track.author.title} - ${track.title}`, {limit: 5});
            if (tracks instanceof Error || tracks.length === 0) return resolve(null);

            const song = await platform.find("track").callback(tracks?.at(0)?.url, {audio: true});
            if (song instanceof Error || !song.link) return resolve(null);

            return resolve(song.link);
        } catch (err) {
            return resolve(Error(err));
        }
    });
}