import {httpsClient} from "@lib/request";
import {API} from "@handler";
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

        return this._track.title.substring(0, 120);
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
        const isDownload = db.audio.cycles.downloader && platform !== "DISCORD";

        //Создаем обещание
        return new Promise(async (resolve) => {
            try {
                //Если трек уже кеширован, то сразу выдаем его
                if (isDownload) {
                    const info = db.audio.cycles.downloader.status(this);
                    if (info.status === "final") return resolve(`file:|${info.path}`);
                }

                //Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
                for (let r = 0; r < 3; r++) {
                    if (!this.link) {
                        const link = await fetchAPIs(this);

                        if (link instanceof Error) return resolve(link);
                        else this.link = link;
                    }

                    //Проверяем ссылку работает ли она
                    if (this.link) {
                        if (await new httpsClient(this.link, {method: "HEAD"}).status) break;
                        else this.link = null;
                    }
                }

                //Если не удается найти ссылку через n попыток
                if (!this.link) return resolve(Error(`[SONG]: Fail update link resource`));
                else if (isDownload && this.link) void (db.audio.cycles.downloader.set(this));
                return resolve(`link:|${this.link}`);
            } catch (err) {
                return Error(`[SONG]: ${err}`);
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Ищем аудио если его нет!
 * @param track {Song} Трек у которого нет аудио
 */
function fetchAPIs(track: Song): Promise<string | Error> {
    return new Promise((resolve) => {
        //Если платформа может самостоятельно выдать аудио
        if (!db.api.platforms.audio.includes(track.platform)) {
            const api = new API.response(track.platform).find("track");

            //Если нет такого запроса
            if (!api) return resolve(Error(`[Song/${track.platform}]: not found callback for track`));

            api.callback(track.url, {audio: true}).then((track: Song | Error) => {
                if (track instanceof Error) return resolve(track);
                return resolve(track.link);
            }).catch((err) => resolve(err));
        }

        //Если платформа не может выдать аудио
        else {
            const youtube = new API.response("YOUTUBE");

            youtube.find("search").callback(`${track.author.title} - ${track.title}`, {limit: 10}).then((videos) => {
                if (videos instanceof Error || videos.length === 0) return resolve(null);

                youtube.find("track").callback(videos?.at(0)?.url, {audio: true}).then((track) => {
                    if (track instanceof Error || !track.link) return resolve(null);
                    return resolve(track.link);
                }).catch((err) => resolve(Error(err)));
            });
        }
    })
}