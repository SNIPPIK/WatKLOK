import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {httpsClient} from "@Client/Request";
import {API, ResponseAPI} from "@handler";
import {Duration} from "@watklok/player";
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
        const api = new ResponseAPI(track.url);
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
            author: { url: db.emojis.diskImage }
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
        const isDownload = db.queue.cycles.downloader && platform !== "DISCORD";

        //Создаем обещание
        return new Promise(async (resolve) => {
            //Если трек уже кеширован, то сразу выдаем его
            if (isDownload) {
                const info = db.queue.cycles.downloader.status(this);
                if (info.status === "final") return resolve(`file:|${info.path}`);
            }

            //Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
            for (let r = 0; r < 3; r++) {
                //Если нет ссылки
                if (!this.link) {
                    const link = await fetchAPIs(this);

                    if (link instanceof Error) return resolve(link);
                    else if (!link) this.link = link;
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
            else if (isDownload && this.link) void (db.queue.cycles.downloader.push = this);
            return resolve(`link:|${this.link}`)
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
        if (!db.platforms.audio.includes(track.platform)) {
            const callback = new ResponseAPI(track.platform).callback("track");

            //Если нет такого запроса
            if (!callback) return resolve(Error(`[Song/${track.platform}]: not found callback for track`));

            return callback(track.url).then((track) => {
                if (track instanceof Error) return resolve(track);
                return resolve(track.link);
            });
        }

        //Если платформа не может выдать аудио
        else {
            const youtube = new ResponseAPI("YOUTUBE");
            const videos = youtube.callback("search")(`${track.author.title} - ${track.title}`);

            return videos.then((tracks) => {
                if (tracks instanceof Error) return resolve(tracks);

                //Если подходящих треков нет, то возвращаем ничего
                if (tracks.length === 0) return resolve(null);

                //Делаем запрос полной информации о треки для получения ссылки на исходный файл музыки
                return youtube.callback("track")(tracks[0].url).then((track: Song) => {
                    if (!track.link) return resolve(null);
                    return resolve(track.link);
                });
            });
        }
    })
}