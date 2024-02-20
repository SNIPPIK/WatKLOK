import { ActionRowBuilder, ApplicationCommandOption, ClientEvents, Colors, CommandInteraction, EmbedData, PermissionResolvable } from "discord.js";
import {ClientInteraction, ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {AudioPlayerEvents, CollectionEvents} from "@watklok/player/collection";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Song} from "@watklok/player/queue/Song";
import {Atlas, Logger} from "@Client";
import {db} from "@Client/db";

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
export interface Event<T extends keyof ClientEvents | keyof CollectionEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название ивента
     * @default null
     * @readonly
     * @public
     */
    name: T extends keyof CollectionEvents ? keyof CollectionEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    type: T extends keyof CollectionEvents | keyof AudioPlayerEvents ? "player" : "client";

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    execute: T extends keyof CollectionEvents ? CollectionEvents[T] : T extends keyof AudioPlayerEvents ? (queue: ArrayQueue, ...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Atlas, ...args: ClientEvents[T]) => void : never;
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
            if (!type.startsWith("http")) type = "search";

            const callback = this._api.requests.find((item) => item.name === type || item.filter && type.match(item.filter));

            if (!callback) return null;

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
    public readonly name: T;
    public readonly filter?: RegExp;
    public readonly callback?: (url: string) => API.callback<T>;

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