import { DownloadManager } from "../Audio/Downloader";
import { httpsClient } from "@httpsClient";
import { platform, Platform } from "@APIs";
import { DurationUtils } from "@Utils/Durations";
import { ClientMessage } from "@Client/Message";
import { Music } from "@db/Config.json";

export { Song, ISong };

class Song {
    /**
     * @description Название трека
     */
    private readonly _title: string;
    //====================== ====================== ====================== ======================
    /**
     * @description Ссылка на трек
     */
    private readonly _url: string;
    //====================== ====================== ====================== ======================
    /**
     * @description Автор трека
     */
    private readonly _author: { url: string, title: string, isVerified?: boolean };
    //====================== ====================== ====================== ======================
    /**
     * @description Пользователь который включил трек
     */
    private readonly _requester: ISong.requester;
    //====================== ====================== ====================== ======================
    /**
     * @description Платформа трека
     */
    private readonly _platform: platform;
    //====================== ====================== ====================== ======================
    /**
     * @description Время длительности трека
     * @param seconds {number} В секундах
     * @param full {string} В формате 00:00:00
     */
    private readonly _duration: { seconds: number, full: string };
    //====================== ====================== ====================== ======================
    /**
     * @description Изображение трека и автора
     * @param track {ISong.image} Картинка трека
     * @param author {ISong.image} Картинка автора
     */
    private readonly _images: { track: ISong.image, author: ISong.image };
    //====================== ====================== ====================== ======================
    /**
     * @description Прочие модификаторы
     * @param isLive {boolean} Если трек является live
     */
    private readonly _other: { isLive: boolean };
    //====================== ====================== ====================== ======================
    /**
     * @description Ссылка на исходный ресурс или путь до файла
     */
    private _link: string = null;
    //====================== ====================== ====================== ======================
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем цвет трека
     */
    public get color() { return Platform.color(this._platform); };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем название трека
     */
    public get title() { return this._title; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ссылку на трек
     */
    public get url() { return this._url; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные автора трека
     */
    public get author() { return this._author; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем пользователя который включил трек
     */
    public get requester() { return this._requester; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем платформу у которого был взят трек
     */
    public get platform() { return this._platform; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем время трека
     */
    public get duration() { return this._duration; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем картинки автора и трека
     */
    public get image() { return this._images; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем доп данные
     */
    public get options() { return this._other; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ссылку на исходный файл
     */
    private get link() { return this._link; };
    //====================== ====================== ====================== ======================
    /**
     * @description Изменяем данные ссылки
     */
    private set link(link) { this._link = link; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ссылку на исходный ресурс
     */
    public get resource() {
        return new Promise<string>(async (resolve) => {
            //Если пользователь включил кеширование музыки
            if (Music.CacheMusic) {
                const info = DownloadManager.getNames(this);

                //Если есть файл выдаем путь до него
                if (info.status === "final") return resolve(info.path);
            }

            let reqs = 0;
            while (reqs < 3) {
                //Если нет ссылки, то ищем трек
                if (!this.link) this.link = await Platform.searchResource(this);
                else {
                    //Проверяем ссылку на работоспособность
                    const status = new httpsClient(this.link).status;

                    //Если ссылка работает
                    if (status) break;
                }

                reqs++;
            }

            return resolve(this.link);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Подгоняем трек под общую сетку
     */
    public constructor(track: ISong.track, author: ClientMessage["author"]) {
        //Данные об пользователе
        const { username, id, avatar } = author;
        const seconds = parseInt(track.duration.seconds);

        this._title = track.title;
        this._url = track.url;
        this._platform = Platform.name(track.url);

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
            track: validURL(track?.image) ? track?.image : { url: Music.note },
            author: validURL(track.author?.image) ? track.author?.image : { url: Music.note }
        };

        //Время трека
        this._duration = {
            full: seconds > 0 ? DurationUtils.ParsingTimeToString(seconds) : "Live", seconds
        };

        //Пользователь, который включил трек
        this._requester = {
            username, id,
            avatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };

        if (validURL(track.format)) this._link = track.format.url;
    };
}

//====================== ====================== ====================== ======================
/**
 * @description Проверка является ли ссылка ссылкой
 * @param image {{url: string}} Объект со ссылкой
 */
function validURL(image: { url: string }): boolean {
    return !!image && !!image.url;
}
//====================== ====================== ====================== ======================
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
    //====================== ====================== ====================== ======================
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
    //====================== ====================== ====================== ======================
    /**
     * @description Пример получаемого автора трека
     */
    export interface author {
        //Имя автора
        title: string;

        //Ссылка на автора
        url: string | undefined;
        image?: image;
        isVerified?: boolean;
    }
    //====================== ====================== ====================== ======================
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
    //====================== ====================== ====================== ======================
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