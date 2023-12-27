import {Song} from "@components/AudioClient/Queue/Song";

import {db} from "@components/QuickDB";
/**
 * @author SNIPPIK
 * @description Для загрузки запросов из файлов
 * @namespace API
 */
export namespace API {
    /**
     * @description Доступные платформы
     * @type
     */
    export type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

    /**
     * @description Доступные запросы
     * @type
     */
    export type callback = "track" | "playlist" | "search" | "album" | "artist";

    /**
     * @description Что должен выдавать подгружаемый файл
     * @interface
     */
    export interface load {
        requests: (API.list | API.array | API.track)[]; name: platform;
        audio: boolean;                                 auth: boolean;
        prefix?: string[];                              color: number;
        filter: RegExp;                                 url: string;
    }

    /**
     * @description Структура получение трека
     * @interface
     */
    export interface track {
        filter: RegExp;
        type: "track";
        callback: (url: string) => Promise<Song | Error>;
    }

    /**
     * @description Структура получение нескольких объектов
     * @interface
     */
    export interface array {
        filter?: RegExp;
        type: "search" | "artist";
        callback: (url: string) => Promise<Song[] | Error>;
    }

    /**
     * @description Структура объектов и данных об объектах
     * @interface
     */
    export interface list {
        filter: RegExp;
        type: "playlist" | "album";
        callback: (url: string) => Promise<Song.playlist | Error>;
    }
}



/**
 * @author SNIPPIK
 * @description Необходим для взаимодействия с db.music.platform
 * @class APIs
 */
export class APIs {
    private readonly _name: API.platform;
    private readonly _requests: API.load["requests"];
    private readonly _color: number;

    /**
     * @description Выдаем название
     * @return API.platform
     * @public
     */
    public get platform() { return this._name; };

    /**
     * @description Выдаем bool, Недоступна ли платформа
     * @return boolean
     * @public
     */
    public get block() { return db.music.platforms.block.includes(this._name); };

    /**
     * @description Выдаем bool, есть ли доступ к платформе
     * @return boolean
     * @public
     */
    public get auth() { return db.music.platforms.authorization.includes(this._name); };

    /**
     * @description Выдаем bool, есть ли доступ к файлам аудио
     * @return boolean
     * @public
     */
    public get audio() { return db.music.platforms.audio.includes(this._name); };

    /**
     * @description Выдаем int, цвет платформы
     * @return number
     * @public
     */
    public get color() { return this._color; };

    /**
     * @description Получаем тип запроса
     * @param url {string} Ссылка
     * @public
     */
    public type = (url: string): API.callback => {
        if (!url.startsWith("http")) return "search";

        const type = this._requests.find((data) => data.filter && url.match(data.filter));

        return type?.type ?? undefined;
    };

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {callback} Тип запроса
     * @public
     */
    public callback (type: "track"): (url: string) => Promise<Song | Error>;
    public callback (type: "search" | "artist"): (url: string) => Promise<Song[] | Error>;
    public callback (type: "playlist" | "album"): (url: string) => Promise<Song.playlist | Error>;
    public callback (type: API.callback): (url: string) => Promise<Song.playlist | Song[] | Song | Error>;
    public callback(type: any): any {
        const callback = this._requests.find((data) => data.type === type);

        if (!callback) return null;

        return callback.callback;
    };

    /**
     * @description Ищем из аргумента нужную платформу
     * @param argument {string | API.platform} Имя платформы или ссылка на трек, видео, плейлист, альбом, автора
     * @public
     */
    public constructor(argument: string | API.platform) {
        const temp = db.music.platforms.supported;

        //Если была указана ссылка
        if (argument.startsWith("http")) {
            const platform = temp.find((info) => !!argument.match(info.filter));

            //Если не найдена платформа тогда используем DISCORD
            if (!platform) {
                const {requests, name} = temp.find((info) => info.name === "DISCORD");
                this._name = name; this._requests = requests; this._color = platform.color;
                return;
            }
            this._name = platform.name; this._requests = platform.requests; this._color = platform.color;
            return;
        }

        //Если был указан текст
        try {
            const platform = temp.find((info) => info.name === argument || info.prefix && info.prefix.includes(argument.split(' ')[0].toLowerCase()));

            //Не найдена платформа тогда используем YOUTUBE
            if (!platform) {
                const yt = temp.find((info) => info.name === "YOUTUBE");
                this._name = yt.name; this._color = yt.color; this._requests = yt.requests;
                return;
            }

            this._name = platform.name; this._requests = platform.requests; this._color = platform.color;
        } catch { //Если произошла ошибка значит используем YOUTUBE
            const yt = temp.find((info) => info.name === "YOUTUBE");
            this._name = yt.name; this._color = yt.color; this._requests = yt.requests;
        }
    };
}