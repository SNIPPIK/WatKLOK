import {
    ActionRowBuilder,
    ApplicationCommandOption,
    ClientEvents,
    Colors,
    EmbedData,
    PermissionResolvable
} from "discord.js";
import {AudioPlayerEvents} from "@lib/player/AudioPlayer";
import {CollectionAudioEvents, db} from "@lib/db";
import {Queue} from "@lib/player/queue/Queue";
import {Song} from "@lib/player/queue/Song";
import {readdirSync} from "node:fs";
import {Client} from "@lib/discord";
import {Logger} from "@env";

/**
 * @author SNIPPIK
 * @description Класс загрузки каталогов handlers
 * @class Handler
 */
export class Handler<T> {
    private readonly _options = {
        /**
         * @description Действие при получении данных из файла
         * @default null
         */
        callback: null as (data: T | {error: true, message: string}, file?: string, dir?: string) => void,

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
 * @description Интерфейсы для загрузки
 * @namespace Handler
 */
export namespace Handler {
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
         * @description Опции для slashCommand
         * @default null
         * @readonly
         * @public
         */
        options?: ApplicationCommandOption[];

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
         * @description Выполнение команды
         * @default null
         * @readonly
         * @public
         */
        execute: (options: {
            message: Client.message | Client.interact,
            args?: string[],
            group?: string,
            sub?: string
        }) => Constructor.messageOptions<any> | Promise<Constructor.messageOptions<any>>;
    }

    /**
     * @author SNIPPIK
     * @description Интерфейс для плагинов
     * @interface Plugin
     */
    export interface Plugin {
        /**
         * @description Запуск плагина
         * @public
         */
        start: (options: {client: Client}) => void;
    }
}

/**
 * @author SNIPPIK
 * @description Вспомогательные классы
 * @namespace Constructor
 */
export namespace Constructor {
    /**
     * @author SNIPPIK
     * @description Коллекция
     * @abstract
     */
    export abstract class Collection<K> {
        private readonly data =  new Map<string, K>();
        /**
         * @description Получаем объект из ID
         * @param ID - ID объекта
         * @public
         */
        public get = (ID: string) => {
            return this.data.get(ID);
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
                this.data.set(ID, value);
                return value;
            } else {
                Logger.log("WARN", `Collection has duplicated ${ID}`);
            }

            return item;
        };

        /**
         * @description Удаляем элемент из списка
         * @param ID - ID Сервера
         * @public
         */
        public remove = (ID: string) => {
            const item: any = this.data.get(ID);

            if (item) {
                if ("disconnect" in item) item?.disconnect();
                if ("cleanup" in item) item?.cleanup();
                if ("destroy" in item) item?.destroy();

                this.data.delete(ID);
            }
        };

        /**
         * @description Получаем случайный объект из класса MAP
         * @public
         */
        public get random(): K {
            const keys = Array.from(this.data.keys());
            const key = keys[Math.floor(Math.random() * keys.length)];

            return this.get(key);
        };

        /**
         * @description Получаем кол-во объектов в списке
         * @public
         */
        public get size() {
            return this.data.size;
        };
    }

    /**
     * @author SNIPPIK
     * @description Загрузчик классов
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
     * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
     * @class Cycle
     * @abstract
     */
    export abstract class Cycle<T = unknown> {
        private readonly data = {
            array: [] as T[],
            time: 0
        };

        public readonly _config: TimeCycleConfig<T> = {
            name: "timeCycle",
            execute: null,
            filter: null,
            duration: 10e3,
            custom: { push: null }
        };

        protected constructor(options: TimeCycleConfig<T>) {
            Object.assign(this._config, options);
        };

        /**
         * @description Выдаем коллекцию
         * @public
         */
        public get array() { return this.data.array; }

        /**
         * @description Добавляем элемент в очередь
         * @param item - Объект T
         * @public
         */
        public set = (item: T) => {
            if (this._config.custom?.push) this._config.custom?.push(item);
            else if (this.data.array.includes(item)) this.remove(item);

            //Добавляем данные в цикл
            this.data.array.push(item);

            //Запускаем цикл
            if (this.data.array?.length === 1 && this.data.time === 0) {
                Logger.log("DEBUG", `[Cycle/${this._config.name}]: Start cycle`);

                this.data.time = Date.now();
                setImmediate(this._stepCycle);
            }
        };

        /**
         * @description Удаляем элемент из очереди
         * @param item - Объект T
         * @public
         */
        public remove = (item: T) => {
            const index = this.data.array.indexOf(item);

            if (index !== -1) {
                if (this._config.custom?.remove) this._config.custom.remove(item);
                this.data.array.splice(index, 1);
            }
        };

        /**
         * @description Выполняем this._execute
         * @private
         */
        private _stepCycle = (): void => {
            if (this.data.array?.length === 0) {
                Logger.log("DEBUG", `[Cycle/${this._config.name}]: Stop cycle`);
                this.data.time = 0;
                return;
            }

            //Высчитываем время для выполнения
            this.data.time += this._config.duration;

            for (let item of this.data.array) {
                const filtered = this._config.filter(item);

                try {
                    if (filtered) this._config.execute(item);
                } catch (error) {
                    this.remove(item);
                    Logger.log("WARN", `[Cycle/${this._config.name}]: Error in this._execute | ${error}`);
                }
            }

            //Выполняем функцию через ~this._time ms
            setTimeout(this._stepCycle, this.data.time - Date.now());
        };
    }

    /**
     * @author SNIPPIK
     * @description Интерфейс для опций TimeCycle
     */
    interface TimeCycleConfig<T> {
        //Название цикла
        name: string;

        //Функция выполнения
        execute: (item: T) => void;

        //Функция фильтрации
        filter: (item: T) => boolean;

        //Время через которое надо запустить цикл
        duration: number;

        //Модификации цикла, не обязательно
        custom?: {
            //Изменить логику добавления
            push?: (item: T) => void;

            //Изменить логику удаления
            remove?: (item: T) => void;
        };
    }
}

/**
 * @author SNIPPIK
 * @description Управление отправкой сообщений
 * @namespace Constructor
 * @dublicate
 */
export namespace Constructor {
    /**
     * @author SNIPPIK
     * @description Параметры для класса message
     */
    export type messageOptions<T> =
        (T extends "menu" ? messageTypes.menu :
            T extends "simple" ? messageTypes.simple :
                T extends "embeds" ? messageTypes.embeds : never) & messageTypes.main;

    /**
     * @author SNIPPIK
     * @description Типы данные для взаимодействия с классом message
     */
    export namespace messageTypes {
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
     * @author SNIPPIK
     * @description Создает сообщения для отправки на Discord
     * @class message
     */
    export class message<T> {
        //@ts-ignore
        private readonly data: messageOptions<T> & {message: Client.message | Client.interact; fetchReply?: boolean} = {time: 15e3, fetchReply: true};
        /**
         * @description Получаем данные заданные при создании класса
         * @return messageOptions
         * @public
         */
        public get options() { return this.data; };

        /**
         * @description Получаем цвет, если он есть в параметрах конвертируем в число
         * @private
         */
        private get color() {
            const options = this.options;

            if (!("color" in options)) return 258044;
            else if (typeof options.color === "number") return options.color;
            return Colors[options.color] ?? 258044;
        };

        /**
         * @description Редактируем параметры заданные при создании класса
         * @protected
         */
        protected get modificationOptions() {
            let options = this.options;

            //Если указано простое сообщение
            if ("content" in options && !("page" in options)) {
                const color = options.color;
                let text = "";

                if (options.codeBlock) {
                    if (color === "DarkRed") text = `⛔️ **Error**\n`;
                    else if (color === "Yellow") text = `⚠️ **Warning**\n`;
                } else {
                    if (color === "DarkRed") text = `⛔️ **Error** | `;
                    else if (color === "Yellow") text = `⚠️ **Warning** | `;
                }

                options = {
                    ...options, embeds: [{
                        color: this.color,
                        description: text + (options.codeBlock ? `\`\`\`${options.codeBlock}\n${options.content}\n\`\`\`` : options.content)
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
            const {message, replied} = this.options;

            if ("replied" in message && !(message as any).replied && !replied) {
                if (message.isRepliable()) return message.reply(this.modificationOptions);
                return message.followUp(this.modificationOptions);
            }

            return message.channel.send(this.modificationOptions) as Promise<Client.message>;
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
         * @description Создаем класс с заданными параметрами
         * @param options
         */
        public constructor(options: message<T>["options"]) {
            Object.assign(this.data, options);
            const {time, promise} = options;

            //Если используется сборщик меню
            if ("page" in options) {
                //Добавляем кнопки
                this.data.components = [{
                    type: 1, components: [
                        {type: 2, emoji: {name: "⬅"}, custom_id: "back", style: 2},
                        {type: 2, emoji: {name: "➡"}, custom_id: "next", style: 2},
                        {type: 2, emoji: {name: "🗑️"}, custom_id: "cancel", style: 4}
                    ]
                }] as any;
            }

            //Отправляем сообщение
            this.channel.then((msg) => {
                //Удаляем сообщение через время если это возможно
                if (time !== 0) message.delete = {message: msg, time};

                //Если получить возврат не удалось, то ничего не делаем
                if (!msg) return;

                //Если надо выполнить действия после
                if (promise) promise(msg);

                //Если меню, то не надо удалять
                if ("page" in options) this.createMenuTable(msg);
            }).catch((err) => Logger.log("ERROR", `${err}`));
        };

        /**
         * @description Создаем меню с объектами
         * @param msg - Сообщение пользователя
         * @return void
         */
        private createMenuTable = (msg: Client.message) => {
            let {page, pages, callback} = this.options as messageTypes.menu;

            const collector = msg.createMessageComponentCollector({
                time: 60e3, componentType: 2,
                filter: (click) => click.user.id !== msg.client.user.id
            });

            collector.on("collect", (i) => {
                //Игнорируем ошибки
                try {
                    i.deferReply();
                    i.deleteReply();
                } catch {
                }

                //Если нельзя поменять страницу
                if (page === pages.length || page < 1) return;

                //Кнопка переключения на предыдущую страницу
                if (i.customId === "back") page--;
                //Кнопка переключения на следующую страницу
                else if (i.customId === "next") page++;
                //Кнопка отмены и удаления сообщения
                else if (i.customId === "cancel") {
                    message.delete = {time: 2e3, message: msg};
                    return;
                }

                return callback(msg, pages, page);
            });
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
     * @description Создаем класс для итогового запроса
     * @class item
     * @abstract
     */
    export abstract class item<T extends callbacks> {
        public readonly name: T;
        public readonly filter?: RegExp;
        public readonly callback?: (url: string, options: T extends "track" ? {audio?: boolean} : {limit?: number}) => callback<T>;
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
        public get block() { return db.api.platforms.block.includes(this.platform); };

        /**
         * @description Выдаем bool, есть ли доступ к платформе
         * @return boolean
         * @public
         */
        public get auth() { return db.api.platforms.authorization.includes(this.platform); };

        /**
         * @description Выдаем bool, есть ли доступ к файлам аудио
         * @return boolean
         * @public
         */
        public get audio() { return db.api.platforms.audio.includes(this.platform); };

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
            const temp = db.api.platforms.supported;

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
     * @description Создаем класс для запроса на сервер
     * @interface request
     * @abstract
     */
    export interface request {
        name: platform;
        url: string;
        audio: boolean;
        auth: boolean;
        filter: RegExp;
        color: number;
        requests: item<callbacks>[];
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
    export type callbacks = "track" | "playlist" | "search" | "album" | "author";

    /**
     * @description Функция запроса
     * @type callback<callbacks>
     */
    export type callback<T> = Promise<(T extends "track" ? Song : T extends "playlist" | "album" ? Song.playlist : T extends "search" | "author" ? Song[] : never) | Error>
}