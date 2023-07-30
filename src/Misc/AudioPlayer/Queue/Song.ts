import { ClientMessage } from "@Client/Message";
import {DownloadManager} from "@Client/Cycles";
import { platform, APIs } from "@APIs";
import { Duration } from "@Util/Duration";
import { httpsClient } from "@Request";
import {env} from "@env";

export {ISong, Song}

const Downloader = env.get("music.cache.enable") ? new DownloadManager() : null;
const note = env.get("music.note");

class Song_data {
    readonly _title: string;
    readonly _url: string;
    readonly _author: { url: string, title: string, isVerified?: boolean };
    readonly _requester: ISong.requester;
    readonly _platform: platform;
    readonly _duration: { seconds: number, full: string };
    readonly _images: { track: ISong.image, author: ISong.image };
    readonly _other: { isLive: boolean };
    _link: string = null;

    public constructor(track: ISong.track, author: ClientMessage["author"]) {
        //Данные об пользователе
        const { username, id, avatar } = author;
        const seconds = parseInt(track.duration.seconds);

        this._title = track.title;
        this._url = track.url;
        this._platform = new APIs(track.url).platform;

        //Прочие
        this._other = {
            isLive: track.isLive
        };

        //Информация об авторе
        this._author = {
            url: !track.author?.url || track.author?.url === "" ? "" : track.author.url,
            title: !track.author?.title || track.author?.title === "" ? "Не найдено имя автора" : track.author.title
        };

        //Изображения трека и автора
        this._images = {
            track: validURL(track?.image) ? track?.image : { url: note },
            author: validURL(track.author?.image) ? track.author?.image : { url: note }
        };

        //Время трека
        this._duration = { seconds,
            full: seconds === 0 ? "Live": Duration.toConverting(seconds) as string
        };

        //Пользователь, который включил трек
        this._requester = {
            username, id,
            avatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };

        if (validURL(track.format)) this._link = track.format.url;
    };
}


class Song extends Song_data {
    /**
     * @description Получаем цвет трека
     */
    public get color() { return new APIs(this._platform).color; };

    /**
     * @description Получаем название трека
     */
    public get title() { return this._title; };

    /**
     * @description Получаем ссылку на трек
     */
    public get url() { return this._url; };

    /**
     * @description Получаем данные автора трека
     */
    public get author() { return this._author; };

    /**
     * @description Получаем пользователя который включил трек
     */
    public get requester() { return this._requester; };

    /**
     * @description Получаем платформу у которого был взят трек
     */
    public get platform() { return this._platform; };

    /**
     * @description Получаем время трека
     */
    public get duration() { return this._duration; };

    /**
     * @description Получаем картинки автора и трека
     */
    public get image() { return this._images; };

    /**
     * @description Получаем доп данные
     */
    public get options() { return this._other; };

    /**
     * @description Получаем ссылку на исходный файл
     */
    public get link() { return this._link; };

    /**
     * @description Изменяем данные ссылки
     */
    private set link(link: string) { this._link = link; };

    /**
     * @description Получаем ссылку на исходный ресурс
     */
    public get resource() {
        return new Promise<string>(async (resolve) => {
            if (Downloader) {
                const info = Downloader.status(this);
                if (info.status === "final") return resolve(info.path);
            }

            for (let req = 0; req < 3; req++) {
                if (!this.link) this.link = await APIs.resource(this);
                else {
                    const status: boolean = await new httpsClient(this.link, { method: "HEAD" }).status;

                    if (status) break;
                    else this.link = null;
                }
            }

            if (Downloader && this.link.length > 10) Downloader.push = this;
            return resolve(this.link);
        });
    };
}


/**
 * @description Проверка является ли ссылка ссылкой
 * @param image {{url: string}} Объект со ссылкой
 */
function validURL(image: { url: string }): boolean {
    return !!image && !!image.url;
}

/**
 * @description Все интерфейсы для работы системы треков
 */
namespace ISong {
    /**
     * @description Какие данные доступны в <song>.requester
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
     */
    export interface playlist {
        url: string;
        title: string;
        items: track[];
        image: { url: string; };
        author?: author;
    }


    /**
     * @description Параметры картинки
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