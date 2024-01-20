import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {httpsClient} from "@Client/Request";
import {API, RequestAPI} from "@handler";
import {Duration} from "../index";
import {db} from "@Client/db";

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
        avatarURL: () => string | null;
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

        //Трек в прямом эфире
        isLive?: boolean;

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
        format?: {
            //Ссылка на исходный файл
            url: string | null
        };
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
    private readonly _platform: API.platform;
    private readonly _url: string;
    private readonly _title: string;
    private readonly _color: number;
    private readonly _author: { url: string, title: string, isVerified?: boolean };
    private readonly _duration: { seconds: number, full: string };
    private readonly _images: { track: Song.image, author: Song.image };
    private readonly _other: { isLive: boolean };
    private _requester: Song.requester;
    public _link: string = null;
    public constructor(track: Song.track) {
        const api = new RequestAPI(track.url);
        const seconds = parseInt(track.duration.seconds) || 321;

        this._title = track.title;
        this._url = track.url;
        this._platform = api.platform;
        this._color = api.color;

        //Прочие
        this._other = { isLive: track?.isLive || seconds === 0 };

        //Информация об авторе
        this._author = {
            url: !track.author?.url || track.author?.url === "" ? "" : track.author.url,
            title: !track.author?.title || track.author?.title === "" ? "Не найдено имя автора" : track.author.title
        };

        //Изображения трека и автора
        this._images = {
            track: track?.image ?? { url: db.emojis.noImage },
            author: track.author?.image ?? { url: db.emojis.diskImage }
        };

        //Время трека
        if (!isNaN(seconds) && !track.duration.seconds.match(/:/)) this._duration = { full: seconds === 0 ? "Live" : Duration.parseDuration(seconds), seconds };
        else this._duration = { full: track.duration.seconds, seconds };

        if (track.format && track.format?.url) this._link = track.format.url;
    };

    /**
     * @description Получаем цвет трека
     * @public
     */
    public get color() { return this._color; };

    /**
     * @description Получаем название трека
     * @public
     */
    public get title() { return this._title.substring(0, 120); };

    /**
     * @description Получаем ссылку на трек
     * @public
     */
    public get url() { return this._url; };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get author() { return this._author; };

    /**
     * @description Получаем пользователя который включил трек
     * @public
     */
    public get requester() { return this._requester; };
    public set requesterSong(author: ClientMessage["author"]) {
        const { username, id, avatar } = author;

        //Пользователь, который включил трек
        this._requester = {
            username, id,
            avatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    }

    /**
     * @description Получаем платформу у которого был взят трек
     * @public
     */
    public get platform() { return this._platform; };

    /**
     * @description Получаем время трека
     * @public
     */
    public get duration() { return this._duration; };

    /**
     * @description Получаем картинки автора и трека
     * @public
     */
    public get image() { return this._images; };

    /**
     * @description Получаем доп данные
     * @public
     */
    public get options() { return this._other; };

    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() { return this._link; };
    public set link(url: string) { this._link = url; }


    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return string | Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        const platform = this.platform;
        const isDownload = db.music.queue.cycles.downloader && platform !== "DISCORD";

        return new Promise<string | Error>(async (resolve) => {
            //Если трек уже кеширован, то сразу выдаем его
            if (isDownload) {
                const info = db.music.queue.cycles.downloader.status(this);
                if (info.status === "final") return resolve(`file:|${info.path}`);
            }

            //Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
            for (let req = 0; req < 3; req++) {
                //Если нет ссылки, то пытаемся ее получить
                if (!this._link) {
                    try {
                        this._link = await resource(platform, this.url, this.author.title, this.title, this.duration.seconds);
                    } catch {
                        this._link = null;
                        break;
                    }
                }

                //Проверяем ссылку работает ли она
                if (await new httpsClient(this.link, {method: "HEAD"}).status) break;
                else this._link = null;
            }

            //Если не удается найти ссылку через n попыток
            if (!this._link) return resolve(Error(`[SONG]: Fail update link resource`));
            else if (isDownload && this._link) void (db.music.queue.cycles.downloader.push(this));
            return resolve(`link:|${this.link}`)
        });
    };
}

/**
 * @description Получаем исходный файл музыки
 * @return Promise<string>
 */
function resource(platform: API.platform, url: string, author: string, title: string, duration: number): Promise<string> {
    return new Promise<string>(async (resolve) => {
        if (!db.music.platforms.audio.includes(platform)) {
            const callback = new RequestAPI(platform).callback("track");

            //Если нет такого запроса
            if (callback) {
                const track = await callback(url);

                //Если произошла ошибка при получении ссылки
                if (track instanceof Error) return resolve(null);

                return resolve(track.link);
            }

            //Если нет запроса, это невозможно, но мало ли!
            return resolve(null);
        }

        //Делаем 1 запрос
        let track = searchTrack(`${author} ${title}`, duration);
        if (track instanceof Error) return resolve(null);

        //Делаем 2 запрос, если с 1 что-то не так
        if (!track) {
            track = searchTrack(`${title}`, duration);
            if (track instanceof Error) return resolve(null);
        }

        //Выводим что у нас получилось
        return resolve(track as Promise<string>);
    });
}

/**
 * @description Если у платформы нет возможности дать исходный файл то ищем его на других платформах
 * @param nameSong {string} Название трека
 * @param duration {number} Длительность трека
 * @return Promise<string | Error>
 */
function searchTrack(nameSong: string, duration: number) {
    return new Promise<string | Error>(async (resolve) => {
        const randomPlatform = getRandomPlatform();
        const track = randomPlatform.requests.find((d) => d.type === "track");
        const search = randomPlatform.requests.find((d) => d.type === "search");
        const tracks = await search.callback(nameSong) as Song[] | Error; //Ищем треки

        //Если поиск выдал ошибку или нет треков возвращаем ничего
        if (tracks instanceof Error || tracks.length === 0) return resolve(null);

        //Ищем подходящие треки
        const GoodTracks = tracks.filter((track) => {
            const DurationSong: number = track.duration.seconds;

            //Как надо фильтровать треки
            return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
        });

        //Если подходящих треков нет, то возвращаем ничего
        if (GoodTracks.length === 0) return resolve(null);

        try {
            //Делаем запрос полной информации о треки для получения ссылки на исходный файл музыки
            track.callback(GoodTracks[0].url).then((track: any) => {
                if (!track?.format?.url) return resolve(null);
                return resolve(track?.format?.url);
            });
        } catch (e) { return resolve(Error(e)); }
    });
}


/**
 * @author SNIPPIK
 * @description Получаем случайную платформу
 * @return API.load
 */
function getRandomPlatform() {
    const randomAPI = db.music.platforms.supported.filter((platform) => !db.music.platforms.audio.includes(platform.name)
        && !db.music.platforms.authorization.includes(platform.name)
        && platform.requests.find((pl) => pl.type === "search")
        && platform.requests.find((pl) => pl.type === "track")
    );

    return randomAPI[Duration.randomNumber(0, randomAPI.length)];
}