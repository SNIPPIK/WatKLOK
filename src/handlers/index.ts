import {LightMessageBuilder, MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {CollectionAudioEvents} from "@handler/Database/Global/Audio";
import {IntentsCommand} from "@lib/discord/utils/IntentsCommand";
import {AudioPlayerEvents} from "@lib/voice/player";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Song} from "@lib/voice/player/queue/Song";
import {ClientEvents} from "discord.js";
import {readdirSync} from "node:fs";
import {Client} from "@lib/discord";
import {Logger} from "@env";
import {db} from "@lib/db";

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
            if (dir.endsWith(".ts") && !dir.endsWith(".js")) return;

            readdirSync(this.path + `/${dir}`).forEach((file) => {
                if (!file.endsWith(".ts") && !file.endsWith(".js")) return;

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
        execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
    }

    /**
     * @author SNIPPIK
     * @description Интерфейс для команд
     * @interface Command
     */
    export interface Command {
        /**
         * @description Данные команды для отправки на сервера discord
         * @default Необходим ввод данных
         * @readonly
         * @public
         */
        data: SlashBuilder["json"];

        /**
         * @description Команду может использовать только разработчик
         * @default false
         * @readonly
         * @public
         */
        owner?: boolean;

        /**
         * @description Разрешения для команды
         * @default null
         * @readonly
         * @public
         */
        intents?: IntentsCommand[];

        /**
         * @description Добавлять ли данные после загрузки всех команд
         * @default false
         * @readonly
         * @public
         */
        afterLoad?: boolean;

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
        }) => MessageBuilder | LightMessageBuilder["options"] | Promise<MessageBuilder | LightMessageBuilder["options"]>;
    }

    /**
     * @author SNIPPIK
     * @description Интерфейс для плагинов
     * @interface Plugin
     */
    export interface Plugin {
        /**
         * @description При загрузке плагина будет выполнена это функция
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
            } else Logger.log("WARN", `Collection has duplicated ${ID}`);

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
 * @description Классы для взаимодействия с API
 * @namespace API
 */
export namespace API {
    /**
     * @author SNIPPIK
     * @description Создаем класс запроса для взаимодействия с APIs
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
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
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
     * @type platform
     */
    export type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

    /**
     * @description Доступные запросы
     * @type callbacks
     */
    export type callbacks = "track" | "playlist" | "search" | "album" | "author";

    /**
     * @description Функция запроса
     * @type callback<callbacks>
     */
    export type callback<T> = Promise<(T extends "track" ? Song : T extends "playlist" | "album" ? Song.playlist : T extends "search" | "author" ? Song[] : never) | Error>
}