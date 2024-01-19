import {ActionRowBuilder, ApplicationCommandOption, ClientEvents, EmbedData, PermissionResolvable, Colors, CommandInteraction} from "discord.js";
import {ClientInteraction, ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Song} from "@Client/Audio/Queue/Song";
import {Atlas, Logger} from "@Client";
import {db} from "@Client/db";
/**
 * @author SNIPPIK
 * @description Загрузка команд
 * @class Command
 * @abstract
 */
export abstract class Command {
    /**
     * @description Имя команды
     * @default null
     * @readonly
     * @public
     */
    public readonly name: string = null;

    /**
     * @description Описание команды
     * @default "Нет описания"
     * @readonly
     * @public
     */
    public readonly description: string = "Нет описания";

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    public readonly owner?: boolean = false;

    /**
     * @description Права бота
     * @default null
     * @readonly
     * @public
     */
    public readonly permissions?: PermissionResolvable[] = null;

    /**
     * @description Опции для slashCommand
     * @default null
     * @readonly
     * @public
     */
    public readonly options?: ApplicationCommandOption[] = null;

    /**
     * @description Создаем команду
     * @param options {Command}
     * @protected
     */
    protected constructor(options: Command) {
        Object.assign(this, options);
    };

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    public readonly execute: (message: ClientMessage | ClientInteraction, args?: string[]) => ICommand.all | Promise<ICommand.all> | void;
}

/**
 * @author SNIPPIK
 * @description Класс для событий
 * @class Event
 * @abstract
 */
export abstract class Event<T> {
    /**
     * @description Название ивента
     * @default null
     * @readonly
     * @public
     */
    public readonly name: T;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    public readonly type: "process" | "player" | "atlas" = null;

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    //@ts-ignore
    public execute: (client: Atlas, ...args: ClientEvents[T]) => void;

    /**
     * @description Создаем ивент
     * @param options {Event}
     * @protected
     */
    protected constructor(options: Event<T>) {
        Object.assign(this, options);
    };
}

/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class ArrayCycle
 * @abstract
 */
abstract class ArrayCycle<T = unknown> {
    protected readonly _array?: T[] = [];
    protected _time?: number = 0;
    protected _asyncStep?: () => void;
    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     * @public
     */
    public push? = (data: T) => {
        if ("guild" in (data as ClientMessage)) {
            const old: T = this._array.find(msg => (msg as ClientMessage).guild.id === (data as ClientMessage).guild.id);

            //Если это-же сообщение есть в базе, то нечего не делаем
            if (old) this.remove(old);
        } else if (this._array.includes(data)) this.remove(data);
        this._array.push(data);

        //Запускаем цикл
        if (this._array?.length === 1) {
            Logger.log("DEBUG", `[AsyncCycle]: Start cycle`);

            this._time = Date.now();
            setImmediate(this._asyncStep);
        }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param data {any} Сам элемент
     * @public
     */
    public remove? = (data: T) => {
        if (this._array?.length === 0) return;

        const index = this._array.indexOf(data);
        if (index != -1) {
            if ("edit" in (data as ClientMessage)) {
                if ((data as ClientMessage) && (data as ClientMessage).deletable) (data as ClientMessage).delete().catch(() => undefined);
            }

            this._array.splice(index, 1);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Задаем параметры для циклов и запускаем их
 * @class TimeCycle
 * @abstract
 */
export abstract class TimeCycle<T = unknown> extends ArrayCycle<T> {
    public readonly execute: (item: T) => void;
    public readonly filter: (item: T) => boolean;
    public readonly duration: number;
    protected constructor(options: {
        //Как выполнить функцию
        execute: (item: T) => void;

        //Фильтр объектов
        filter: (item: T) => boolean;

        //Через сколько времени выполнять функцию
        duration: number
    }) {
        super();
        Object.assign(this, options);
    };
    /**
     * @description Выполняем this._execute
     * @private
     */
    protected _asyncStep? = (): void => {
        //Если в базе больше нет объектов
        if (this._array?.length === 0) {
            Logger.log("DEBUG", `[AsyncCycle]: Stop cycle`);
            this._time = 0;
            return;
        }

        //Высчитываем время для выполнения
        this._time += this.duration;

        for (let object of this._array.filter(this.filter)) {
            try {
                this.execute(object);
            } catch (err) {
                this._removeItem(err, object);
            }
        }

        //Выполняем функцию через ~this._time ms
        setTimeout(this._asyncStep, this._time - Date.now());
    };

    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param item {any} Объект который будет удален
     * @private
     */
    private _removeItem? = (err: string, item: T) => {
        Logger.log("WARN", `[AsyncCycle]: Error in this._execute | ${err}`);
        this.remove(item);
    };
}

/**
 * @author SNIPPIK
 * @description Необходим для взаимодействия с APIs
 * @class RequestAPI
 */
export class RequestAPI {
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

/**
 * @author SNIPPIK
 * @description Создает сообщения для отправки на Discord
 * @class ActionMessage
 */
export class ActionMessage {
    private readonly _options: IActionMessage = null;
    /**
     * @description Создаем сообщение
     * @param options {IActionMessage} Настройки сообщения
     */
    public constructor(options: IActionMessage = null) {
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
        }).catch((err) => Logger.log("WARN", err));
    };

    /**
     * @description Создаем меню с объектами
     * @param message {ClientMessage}
     * @return void
     */
    private _createMenu = (message: ClientMessage) => {
        let {page, pages, callback} = this._options as ICommand.menu;

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
 *  _____           _                    __
 * |_   _|         | |                  / _|
 *   | |    _ __   | |_    ___   _ __  | |_    __ _   ___    ___   ___
 *   | |   | '_ \  | __|  / _ \ | '__| |  _|  / _` | / __|  / _ \ / __|
 *  _| |_  | | | | | |_  |  __/ | |    | |   | (_| | \__ \ |  __/ \__ \
 * |_____| |_| |_|  \__|  \___| |_|    |_|    \__,_| |___/  \___| |___/
 */



/**
 * @author SNIPPIK
 * @description Данные которые нужны для отправки сообщений
 * @type IActionMessage
 */
export type IActionMessage = ICommand.all & { message: ClientMessage | ClientInteraction }

/**
 * @author SNIPPIK
 * @description Интерфейсы для команд
 * @namespace ICommand
 */
export namespace ICommand {
    /**
     * @author SNIPPIK
     * @description Если передаются все типы данных
     * @type ICommand.all
     */
    export type all = (context | menu | embeds) & options

    /**
     * @author SNIPPIK
     * @description Данные для отправки текстового сообщения
     * @interface ICommand.context
     */
    export interface context {
        content: string;
        codeBlock?: string;
        color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
    }

    /**
     * @author SNIPPIK
     * @description Данные для отправки ReactionMenu сообщения
     * @interface ICommand.menu
     */
    export interface menu {
        content?: string;
        embeds?: EmbedData[];
        callback: (message: ClientMessage, pages: string[], page: number) => void;
        page: number;
        pages: string[];
    }

    /**
     * @author SNIPPIK
     * @description Данные для отправки EMBED сообщения
     * @interface ICommand.embeds
     */
    export interface embeds {
        embeds: EmbedData[];
    }

    /**
     * @author SNIPPIK
     * @description Доп данные для ActionMessage
     * @interface ICommand.options
     */
    export interface options {
        //Компоненты, такие как кнопки
        components?: ActionRowBuilder[];

        //Что будет делать после отправки сообщения
        promise?: (msg: ClientMessage) => void;

        //Время через которое надо удалить сообщение
        time?: number;

        //Надо отвечать на это сообщение
        replied?: boolean;
    }
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