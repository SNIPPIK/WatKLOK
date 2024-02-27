import { ActionRowBuilder, ApplicationCommandOption, ClientEvents, Colors, CommandInteraction, EmbedData, PermissionResolvable } from "discord.js";
import {ClientInteraction, ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {AudioPlayerEvents} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {CollectionAudioEvents, db} from "@Client/db";
import {Song} from "@watklok/player/queue/Song";
import {Atlas, Logger} from "@Client";
import {readdirSync} from "node:fs";

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

        for (let [name, item] of this.array) {
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
 * @description Создает сообщения для отправки на Discord
 * @class ActionMessage
 */
export class ActionMessage {
    private readonly _options: IActionMessage & { message: ClientMessage | ClientInteraction } = null;
    /**
     * @description Создаем сообщение
     * @param options {object} Настройки сообщения
     */
    public constructor(options: ActionMessage["_options"]) {
        if ("content" in options && !("page" in options)) {
            options = {
                ...options, embeds: [{
                    color: typeof options.color === "number" ? options.color : Colors[options.color] ?? 258044,
                    description: options.codeBlock ? `\`\`\`${options.codeBlock}\n${options.content}\n\`\`\`` : options.content
                }]
            }
            delete options["content"];
        }

        this._options = options;

        this.channel.then((message) => {
            const {time, promise} = this._options;

            if (!message) return;
            //Если надо выполнить действия после
            if (promise) promise(message);

            //Если меню, то не надо удалять
            if ("page" in options) this._createMenu(message);
            else if (time !== 0) ActionMessage.delete = {message, time};
        }).catch((err) => Logger.log("ERROR", err));
    };

    /**
     * @description Создаем меню с объектами
     * @param message {ClientMessage}
     * @return void
     */
    private _createMenu = (message: ClientMessage) => {
        let {page, pages, callback} = this._options as any;

        for (const [key, emoji] of Object.entries({back: "⬅️", cancel: "🗑", next: "➡️"})) {
            message.react(emoji).then(() => message.createReactionCollector({
                filter: (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id,
                time: 60e3
            }).on("collect", ({users}): void => {
                users.remove(this._options.message.author).catch(() => null);

                //Удаляем сообщение
                if (key === "cancel") ActionMessage.delete = {message, time: 2e3};

                //Если нельзя поменять страницу
                else if (page === pages.length || page < 1) return;

                //Выбираем что делать со страничкой, пролистать вперед или назад
                else if (key === "next") page++;
                else page--;

                //Возвращаем функцию
                return callback(message, pages, page);
            }))
        }
    };

    /**
     * @description Получаем канал на который будет отослано сообщение
     * @return Promise<ClientMessage>
     */
    protected get channel(): Promise<ClientMessage> {
        const {message, replied} = this._options;

        if ("replied" in message && !(message as any).replied && !replied) {
            if (message.isRepliable()) return message.reply(this.messageOptions);
            return message.followUp(this.messageOptions);
        }

        return message.channel.send(this.messageOptions) as Promise<ClientMessage>;
    };

    /**
     * @description Получаем данные для отправки сообщения
     * @return object
     */
    protected get messageOptions() {
        return { // @ts-ignore
            content: this._options.content, embeds: this._options?.embeds,
            fetchReply: true, components: this._options.components as any
        };
    };

    /**
     * @description Удаление сообщения через указанное время
     * @param options
     */
    public static set delete(options: { message: CommandInteraction | ClientMessage, time?: number }) {
        const {message, time} = options;

        //Удаляем сообщение
        if ("deletable" in message && message.deletable) {
            setTimeout(() => message.delete().catch(() => {
            }), time ?? 15e3);

            //Удаляем ответ пользователю
        } else if ("replied" in message && !(message as any).replied) {
            setTimeout(() => (message as CommandInteraction)?.deleteReply().catch(() => {
            }), time ?? 15e3);
        }
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
 * @description Данные для отправки сообщения
 */
type IActionMessage = {
    //Компоненты, такие как кнопки
    components?: ActionRowBuilder[];

    //Что будет делать после отправки сообщения
    promise?: (msg: ClientMessage) => void;

    //Время через которое надо удалить сообщение
    time?: number;

    //Надо отвечать на это сообщение
    replied?: boolean;
} & ({ content: string; codeBlock?: string; color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
} | { content?: string; embeds?: EmbedData[]; callback: (message: ClientMessage, pages: string[], page: number) => void; page: number; pages: string[];
} | { embeds: EmbedData[]; });

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
    execute: (message: ClientMessage | ClientInteraction, args?: string[]) => Promise<IActionMessage> | IActionMessage | void;
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