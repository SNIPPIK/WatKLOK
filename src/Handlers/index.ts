import {ActionRowBuilder, ApplicationCommandOption,ClientEvents,Colors,EmbedData,PermissionResolvable} from "discord.js";
import {AudioPlayerEvents} from "@watklok/player/AudioPlayer";
import {Queue} from "@watklok/player/queue/Queue";
import {CollectionAudioEvents, db} from "@Client/db";
import {Song} from "@watklok/player/queue/Song";
import {Client, Logger} from "@Client";
import {readdirSync} from "node:fs";

/**
 * @author SNIPPIK
 * @description Класс загрузки каталогов Handlers
 * @class Handler
 */
export class Handler<T> {
    private readonly _options = {
        /**
         * @description Действие при получении данных из файла
         * @default null
         */
        callback: null as (data: T | {error: true, message: string}, file: string) => void,

        /**
         * @description Путь до загружаемого каталога
         * @default null
         */
        path: null as string
    };
    public constructor(options: Handler<T>["_options"]) {
        this._options = options;

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;

            readdirSync(this.path + `/${dir}`).forEach((file) => {
                if (!file.endsWith(".js")) return;

                //Загружаем файл
                try {
                    const items = this.import(`../../${this.path}/${dir}/${file}`);

                    //Если возникла ошибка при загрузке файла
                    if (items instanceof Error) {
                        Logger.log("ERROR", `[Handler]: ${items}`);
                        return;
                    }

                    if (items instanceof Array) for (let item of items) this._options.callback(new (item as any)(), `${this.path}/${file}`);
                    else this._options.callback(new (items as any)(), `${this.path}/${file}`);
                } catch (err) {
                    Logger.log("ERROR", `[Handler]: ${err}`);
                }
            });
        });
    };

    /**
     * @description Путь до файла без учета файла
     * @return string
     * @public
     */
    public get path() {
        return `src/` + this._options.path;
    };

    /**
     * @description Загружаем файл, поддерживаются только классы
     * @param path - Путь до файла с учетом текущей позиции
     */
    private import = (path: string): Error | T[] => {
        try {
            const file = require(path);

            //Удаляем кеш загрузки
            delete require.cache[require.resolve(path)];

            if (!file?.default) return Error("Not found default import");

            return file.default;
        } catch (err) {
            return Error(err);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Вспомогательные классы
 * @namespace Constructor
 */
export namespace Constructor {
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
                if ("disconnect" in item) item?.disconnect();
                if ("cleanup" in item) item?.cleanup();
                if ("destroy" in item) item?.destroy();

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
     * @description Создает сообщения для отправки на Discord
     * @class message
     */
    export class message {
        private readonly _options: ConstructorMessage & {message?: Client.message | Client.interact; fetchReply?: boolean} = {time: 15e3, embeds: null, fetchReply: true};
        public constructor(options: message["_options"]) {
            Object.assign(this._options, options);
            const {time, promise} = options;

            //Отправляем сообщение
            this.channel.then((msg) => {
                //Удаляем сообщение через время если это возможно
                if (time !== 0) message.delete = {message: msg, time};

                //Если получить возврат не удалось, то ничего не делаем
                if (!msg) return;

                //Если надо выполнить действия после
                if (promise) promise(msg);

                //Если меню, то не надо удалять
                if ("page" in options) this._createMenu(msg);
            }).catch((err) => Logger.log("ERROR", err));
        };
        /**
         * @description Получаем цвет, если он есть в параметрах конвертируем в число
         * @private
         */
        private get color() {
            const options = this._options;

            if ("color" in options) return typeof options.color === "number" ? options.color : Colors[options.color] ?? 258044;
            return 258044;
        };

        /**
         * @description Получаем данные для отправки сообщения
         * @return object
         */
        protected get messageOptions() {
            let options = this._options;

            //Если указано простое сообщение
            if ("content" in options && !("page" in options)) {
                options = {
                    ...options, embeds: [{
                        color: this.color,
                        description: options.codeBlock ? `\`\`\`${options.codeBlock}\n${options.content}\n\`\`\`` : options.content
                    }]
                }
                delete options["content"];
            }

            return options as any;
        };

        /**
         * @description Получаем канал на который будет отослано сообщение
         * @return Promise<Client.message>
         */
        protected get channel(): Promise<Client.message> {
            const {message, replied} = this._options;

            if ("replied" in message && !(message as any).replied && !replied) {
                if (message.isRepliable()) return message.reply(this.messageOptions);
                return message.followUp(this.messageOptions);
            }

            return message.channel.send(this.messageOptions) as Promise<Client.message>;
        };

        /**
         * @description Удаление сообщения через указанное время
         * @param options - Параметры для удаления сообщения
         */
        public static set delete(options: { message: Client.message | Client.interact, time?: number }) {
            const {message, time} = options;

            //Удаляем сообщение
            setTimeout(() => {
                if ("deletable" in message && message.deletable) {
                    message.delete().catch((err) => Logger.log("WARN", err));
                } else if ("replied" in message && !(message as any).replied) {
                    (message)?.deleteReply().catch((err) => Logger.log("WARN", err))
                }
            }, time ?? 15e3);
        };

        /**
         * @description Создаем меню с объектами
         * @param msg - Сообщение пользователя
         * @return void
         */
        private _createMenu = (msg: Client.message) => {
            let {page, pages, callback} = this._options as MessageConstructors.menu;

            for (const [key, emoji] of Object.entries({back: "⬅️", cancel: "🗑", next: "➡️"})) {
                msg.react(emoji).then(() => msg.createReactionCollector({
                    time: 60e3,
                    filter: (reaction, user) => reaction.emoji.name === emoji && user.id !== msg.client.user.id
                }).on("collect", ({users}): void => {
                    users.remove(this._options.message.author).catch(() => null);

                    //Удаляем сообщение
                    if (key === "cancel") message.delete = {time: 2e3, message: msg};

                    //Если нельзя поменять страницу
                    else if (page === pages.length || page < 1) return;

                    //Выбираем что делать со страничкой, пролистать вперед или назад
                    else if (key === "next") page++;
                    else page--;

                    //Возвращаем функцию
                    return callback(msg, pages, page);
                }));
            }
        };
    }
}

/**
 * @author SNIPPIK
 * @description Классы для взаимодействия с API
 * @namespace API
 */
export namespace API {
    /**
     * @author SNIPPIK
     * @description Создаем класс для запроса на сервер
     * @interface request
     * @abstract
     */
    export interface request {
        name: API.platform;
        url: string;
        audio: boolean;
        auth: boolean;
        filter: RegExp;
        color: number;
        requests: item<API.callbacks>[];
    }
    /**
     * @author SNIPPIK
     * @description Создаем класс для итогового запроса
     * @class item
     * @abstract
     */
    export abstract class item<T extends API.callbacks> {
        public readonly callback?: (url: string) => API.callback<T>;
        public readonly filter?: RegExp;
        public readonly name: T;

        /**
         * @description Сохраняем базу данных
         * @param options
         */
        protected constructor(options: item<T>) {
            Object.assign(this, options);
        };
    }

    /**
     * @author SNIPPIK
     * @description Получаем ответ от локальной базы APIs
     * @class response
     */
    export class response {
        private readonly _api: request;
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
        public find<T extends API.callbacks>(type: string | T): item<T> {
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
 * @description Интерфейс для команд
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
    execute: (message: Client.message | Client.interact, args?: string[]) => Promise<ConstructorMessage> | ConstructorMessage | void;
}

/**
 * @author SNIPPIK
 * @description Конструкторы сообщений
 * @namespace MessageConstructors
 */
namespace MessageConstructors {
    /**
     * @description Конструктор меню
     */
    export interface menu {
        content?: string;
        embeds?: EmbedData[];
        pages: string[];
        page: number;
        callback: (message: Client.message, pages: string[], page: number) => void;
    }

    /**
     * @description Конструктор сообщения, отправка текстового сообщения в embed
     */
    export interface simple {
        color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
        codeBlock?: string;
        content: string;
    }

    /**
     * @description Конструктор embeds, отправка своих embeds
     */
    export interface embeds {
        embeds: EmbedData[];
    }

    /**
     * @description Дополнительные параметры для отправки
     */
    export interface main {
        promise?: (msg: Client.message) => void;
        components?: ActionRowBuilder[];
        replied?: boolean;
        time?: number;
    }
}
/**
 * @description Допустимые параметры данных
 * @type ConstructorMessage
 */
type ConstructorMessage = (MessageConstructors.menu | MessageConstructors.embeds | MessageConstructors.simple) & MessageConstructors.main;

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
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
    execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (queue: Queue.Music, ...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
}