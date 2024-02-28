import { ApplicationCommandOption, ClientEvents, PermissionResolvable } from "discord.js";
import {ClientInteraction, ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {MessageConstructorType} from "@Client/MessageConstructor";
import {AudioPlayerEvents} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {CollectionAudioEvents, db} from "@Client/db";
import {Song} from "@watklok/player/queue/Song";
import {readdirSync} from "node:fs";
import {Atlas} from "@Client";

/**
 * @author SNIPPIK
 * @description Мульти коллекция
 * @abstract
 */
export abstract class Collection<K> {
    private readonly array =  new Map<string, K>();
    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: string) => {
        return this.array.get(ID);
    };

    /**
     * @description Что то похожее на filter
     * @param fn - Функция для фильтрации
     * @public
     */
    public filter = (fn: (item: K) => boolean) => {
        const items: K[] = [];

        for (let [_, item] of this.array) {
            if (fn(item)) items.push(item);
        }

        return items;
    };

    /**
     * @description Добавляем объект в список
     * @param ID - ID объекта
     * @param value - Объект для добавления
     * @param promise - Если надо сделать действие с объектом
     * @public
     */
    public set = (ID: string, value: K, promise?: (item: K) => void) => {
        const item = this.get(ID);

        if (!item) {
            if (promise) promise(value);
            this.array.set(ID, value);
            return value;
        }

        return item;
    };

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @public
     */
    public remove = (ID: string) => {
        const item: any = this.array.get(ID);

        if (item) {
            if ("cleanup" in item) item?.cleanup();
            if ("destroy" in item) item?.destroy();
            if ("disconnect" in item) item?.disconnect();

            this.array.delete(ID);
        }
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
        return this.array.size;
    };
}

/**
 * @author SNIPPIK
 * @description Мульти-загрузчик классов
 * @class Assign
 * @abstract
 */
export abstract class Assign<T> {
    /**
     * @description Создаем команду
     * @param options {Command}
     * @protected
     */
    protected constructor(options: T) {
        Object.assign(this, options);
    };
}

/**
 * @author SNIPPIK
 * @description Создаем класс для запроса на сервер
 * @class RequestAPI
 * @abstract
 */
export abstract class RequestAPI {
    public readonly name: API.platform;
    public readonly url: string;
    public readonly audio: boolean;
    public readonly auth: boolean;
    public readonly filter: RegExp;
    public readonly color: number;
    public readonly requests: RequestAPI_item<API.callbacks>[];

    /**
     * @description Сохраняем базу данных
     * @param options
     */
    protected constructor(options: RequestAPI) {
        Object.assign(this, options);
    };
}

/**
 * @author SNIPPIK
 * @description Создаем класс для итогового запроса
 * @class RequestAPI_item
 * @abstract
 */
export abstract class RequestAPI_item<T extends API.callbacks> {
    public readonly callback?: (url: string) => API.callback<T>;
    public readonly filter?: RegExp;
    public readonly name: T;

    /**
     * @description Сохраняем базу данных
     * @param options
     */
    protected constructor(options: RequestAPI_item<T>) {
        Object.assign(this, options);
    };
}


/**
 * @author SNIPPIK
 * @description Класс загрузки директории Handlers
 * @class loadHandlerDir
 * @private
 */
export class loadHandlerDir<T> {
    private readonly path: string;
    private readonly callback: (data: T | {error: true, message: string}, file: string) => void;

    public constructor(path: string, callback: (data: T | {error: true, message: string}, file: string) => void) {
        this.path = `src/${path}`; this.callback = callback;

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };

    /**
     * @description Загружаем файлы из директории
     * @param dir {string} Директория из которой будем читать
     * @return void
     * @private
     */
    private readonly readDir = (dir?: string) => {
        const path = dir ? `${this.path}/${dir}` : this.path;

        readdirSync(path).forEach((file) => {
            if (!file.endsWith(".js")) return;
            const pathFile = `../../${path}/${file}`;

            try {
                const importFile = require(pathFile);
                const keysFile = Object.keys(importFile);

                if (keysFile.length <= 0) this.callback({ error: true, message: "TypeError: Not found imports data!"}, `${path}/${file}`);
                else this.callback(new importFile[keysFile[0]], `${path}/${file}`);
            } catch (e) {
                this.callback({ error: true, message: e}, `${path}/${file}`);
            }

            //Удаляем кеш загрузки
            delete require.cache[require.resolve(pathFile)];
        });
    };
}

/**
 * @author SNIPPIK
 * @description Получаем ответ от локальной базы APIs
 * @class ResponseAPI
 */
export class ResponseAPI {
    private readonly _api: RequestAPI;
    /**
     * @description Выдаем название
     * @return API.platform
     * @public
     */
    public get platform() { return this._api.name; };

    /**
     * @description Выдаем RegExp
     * @return RegExp
     * @public
     */
    public get filter() { return this._api.filter; };


    /**
     * @description Выдаем bool, Недоступна ли платформа
     * @return boolean
     * @public
     */
    public get block() { return db.platforms.block.includes(this.platform); };

    /**
     * @description Выдаем bool, есть ли доступ к платформе
     * @return boolean
     * @public
     */
    public get auth() { return db.platforms.authorization.includes(this.platform); };

    /**
     * @description Выдаем bool, есть ли доступ к файлам аудио
     * @return boolean
     * @public
     */
    public get audio() { return db.platforms.audio.includes(this.platform); };

    /**
     * @description Выдаем int, цвет платформы
     * @return number
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {find} Тип запроса
     * @public
     */
    public find<T extends API.callbacks>(type: string | T): RequestAPI_item<T> {
        try {
            const callback = this._api.requests.find((item) => item.name === type || item.filter && type.match(item.filter));

            if (!callback) {
                if (!type.startsWith("http")) {
                    const requests = this._api.requests.find((item) => item.name === "search");

                    //@ts-ignore
                    if (requests) return requests;
                }

                return null;
            }

            //@ts-ignore
            return callback;
        } catch {
            return undefined;
        }
    };

    /**
     * @description Ищем платформу из доступных
     * @param argument {API.platform} Имя платформы
     * @public
     */
    public constructor(argument: API.platform | string) {
        const temp = db.platforms.supported;

        //Если была указана ссылка
        if (argument.startsWith("http")) {
            const platform = temp.find((info) => !!argument.match(info.filter));

            //Если не найдена платформа тогда используем DISCORD
            if (!platform) { this._api = temp.find((info) => info.name === "DISCORD"); return; }
            this._api = platform; return;
        }

        //Если был указан текст
        try {
            const platform = temp.find((info) => info.name === argument);

            //Не найдена платформа тогда используем YOUTUBE
            if (!platform) { this._api = temp.find((info) => info.name === "YOUTUBE"); return; }

            this._api = platform;
        } catch { //Если произошла ошибка значит используем YOUTUBE
            this._api = temp.find((info) => info.name === "YOUTUBE");
        }
    };
}


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
    export type callbacks = "track" | "playlist" | "search" | "album" | "artist";

    /**
     * @description Функция запроса
     * @type
     */
    export type callback<T> = Promise<(T extends "track" ? Song : T extends "playlist" | "album" ? Song.playlist : T extends "search" | "artist" ? Song[] : never) | Error>
}

/**
 * @author SNIPPIK
 * @description Класс для команд
 * @interface Command
 */
export interface Command {
    /**
     * @description Имя команды
     * @default null
     * @readonly
     * @public
     */
    name: string;

    /**
     * @description Описание команды
     * @default "Нет описания"
     * @readonly
     * @public
     */
    description: string;

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    owner?: boolean;

    /**
     * @description Права бота
     * @default null
     * @readonly
     * @public
     */
    permissions?: PermissionResolvable[];

    /**
     * @description Опции для slashCommand
     * @default null
     * @readonly
     * @public
     */
    options?: ApplicationCommandOption[];

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    execute: (message: ClientMessage | ClientInteraction, args?: string[]) => Promise<MessageConstructorType> | MessageConstructorType | void;
}

/**
 * @author SNIPPIK
 * @description Класс для событий
 * @interface Event
 */
export interface Event<T extends keyof ClientEvents | keyof CollectionAudioEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название ивента
     * @default null
     * @readonly
     * @public
     */
    name: T extends keyof CollectionAudioEvents ? keyof CollectionAudioEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    type: T extends keyof CollectionAudioEvents | keyof AudioPlayerEvents ? "player" : "client";

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (queue: ArrayQueue, ...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Atlas, ...args: ClientEvents[T]) => void : never;
}