import { platform, Platform } from "../Platform";
import { ClientMessage } from "@Client/interactionCreate";
import { DurationUtils } from "@Structures/Durations";
import { Music } from "@db/Config.json";

export { Song, inAuthor, inPlaylist, inTrack };


class Song {
    /**
     * @description Название трека
     */
    private _title: string;
    //====================== ====================== ====================== ======================
    /**
     * @description Ссылка на трек
     */
    private _url: string;
    //====================== ====================== ====================== ======================
    /**
     * @description Автор трека
     */
    private _author: { url: string, title: string, isVerified?: boolean };
    //====================== ====================== ====================== ======================
    /**
     * @description Пользователь который включил трек
     */
    private _requester: SongRequester;
    //====================== ====================== ====================== ======================
    /**
     * @description Платформа трека
     */
    private _platform: platform;
    //====================== ====================== ====================== ======================
    /**
     * @description Время длительности трека
     * @param seconds {number} В секундах
     * @param full {string} В формате 00:00:00
     */
    private _duration: { seconds: number, full: string };
    //====================== ====================== ====================== ======================
    /**
     * @description Изображение трека и автора
     * @param track {inTrack["image"]} Картинка трека
     * @param author {inTrack["image"]} Картинка автора
     */
    private _images: { track: inTrack["image"], author: inTrack["image"] };
    //====================== ====================== ====================== ======================
    /**
     * @description Прочие модификаторы
     * @param isLive {boolean} Если трек является стримом
     */
    private _other: { isLive: boolean };
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
     * @description Получаем платформу с который был взят трек
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
    public get link() { return this._link; };
    //====================== ====================== ====================== ======================
    /**
     * @description Изменяем данные ссылки
     */
    public set link(link) { this._link = link; };
    //====================== ====================== ====================== ======================
    /**
     * @description Подгоняем трек под общую сетку
     */
    public constructor(track: inTrack, author: ClientMessage["author"]) {
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
            title: !track.author?.title || track.author?.title === "" ? "Not found track name" : track.author.title,
            isVerified: track.author?.isVerified ?? undefined
        };

        //Изображения трека и автора
        this._images = {
            track: validURL(track.image) ? track.image : { url: Music.images._image },
            author: validURL(track.author.image) ? track.author.image : { url: Music.images._image }
        };

        //Время трека
        this._duration = {
            seconds,
            full: seconds > 0 ? DurationUtils.ParsingTimeToString(seconds) : "Live"
        };

        //Пользователь который включил трек
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
 * @param image {{url: string}} Обьекст с ссылкой
 */
function validURL(image: { url: string }): boolean {
    return (image || image?.url !== "") && image?.url?.startsWith("http");
}

//====================== ====================== ====================== ======================
/**
 * @description Какие данные доступны в <song>.requester
 * @type interface
 */
interface SongRequester {
    id: string;
    username: string;
    avatarURL: () => string | null;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого трека
 * @type interface
 */
interface inTrack {
    title: string;
    url: string;
    duration: { seconds: string; };
    image?: { url: string; height?: number; width?: number };
    author: {
        title: string;
        url: string | null;
        image?: { url: string | null; width?: number; height?: number; };
        isVerified?: boolean;
    },
    format?: { url: string | null };
    isLive?: boolean;
    PrevFile?: string;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого автора трека
 * @type interface
 */
interface inAuthor {
    title: string;
    url: string | undefined;
    image?: { url: string | undefined; width?: number; height?: number; };
    isVerified?: boolean;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого плейлиста
 * @type interface
 */
interface inPlaylist {
    url: string;
    title: string;
    items: inTrack[];
    image: { url: string; };
    author?: inAuthor;
}
