import {ActionRowBuilder, ApplicationCommandOption, EmbedData, PermissionResolvable, ClientEvents} from "discord.js";
import {ClientInteraction, ClientMessage} from "@handler/Events/Client/interactionCreate";
import {SuperClient} from "@components/Client";
import {readdirSync} from "node:fs";
import {Logger} from "@env";

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
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    // @ts-ignore
    public execute: (client: SuperClient, ...args: ClientEvents[T]) => void;

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
     * @description Как команда используется
     * @default ""
     * @readonly
     * @public
     */
    public readonly usage?: string = "";

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    public readonly isOwner?: boolean = false;

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
     * @description Генерируется в зависимости от названия директории
     * @public
     */
    public type?: string;

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
    public readonly execute: (message: ClientMessage | ClientInteraction, args?: string[]) => ActionType.command | Promise<ActionType.command> | void;
}


/**
 * @author SNIPPIK
 * @description Загрузчик файлов
 * @class initDataDir
 */
export class initDataDir<T = unknown> {
    private readonly path: string;
    private readonly callback: (data: T, file: string) => void;
    private _cacheFile: string = null;
    public constructor(path: string, callback: (data: T, file: string) => void) {
        this.path = `src/${path}`; this.callback = callback;

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };

    /**
     * @description Загружаем первый экспорт из файла
     * @return T
     * @private
     */
    private get loadFile(): T {
        const importFile = require(`../../${this._cacheFile}`);
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
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

            try {
                this._cacheFile = `${path}/${file}`;
                const hasLoad = this.loadFile;

                Logger.debug(`Fs: [Load]: ${this._cacheFile}`);

                this.callback(hasLoad, this._cacheFile);
            } catch (e) { throw Error(e) }
        });
    };
}


/**
 * @description Превращаем Array в Array<Array>
 * @param number {number} Сколько блоков будет в Array
 * @param array {Array} Сам Array
 * @param callback {Function} Как фильтровать
 * @param joined {string} Что добавить в конце
 */
export function ArraySort<V>(number: number = 5, array: V[], callback: (value: V, index?: number) => string, joined: string = "\n\n"): string[] {
    const pages: string[] = [];
    const lists = Array(Math.ceil(array.length / number)).fill(array[0]).map((_, i) => array.slice(i * number, i * number + number));

    for (const list of lists) {
        const text = list.map((value, index) => callback(value, index)).join(joined);

        if (text !== undefined) pages.push(text);
    }

    return pages;
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
 * @description Данные выдаваемые от команд и ActionMessage
 * @export
 */
export namespace ActionType {
    export type command = (ActionContext | ActionEmbeds | ActionMenu) & ActionOptions;

    export type menu = ActionMenu & ActionMain;
    export type content = ActionContext & ActionMain;
    export type embeds = ActionEmbeds & ActionMain;
}


/**
 * @author SNIPPIK
 * @description Данные для отправки ReactionMenu сообщения
 * @interface ActionMenu
 */
interface ActionMenu {
    content?: string;
    embeds?: EmbedData[];
    callback: (message: ClientMessage, pages: string[], page: number) => void;
    page: number;
    pages: string[];
}

/**
 * @author SNIPPIK
 * @description Данные для отправки EMBED сообщения
 * @interface ActionEmbeds
 */
interface ActionEmbeds {
    embeds: EmbedData[];
}

/**
 * @author SNIPPIK
 * @description Данные для отправки текстового сообщения
 * @interface ActionContext
 */
interface ActionContext {
    content: string;
    codeBlock?: string;
    color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
}

/**
 * @author SNIPPIK
 * @description Необходимые данные для ActionMessage
 * @interface ActionMain
 */
interface ActionMain extends ActionOptions {
    //Канал на который будет отправлено сообщение
    message: ClientMessage | ClientInteraction;
}

/**
 * @author SNIPPIK
 * @description Доп данные для ActionMessage
 * @interface ActionOptions
 */
interface ActionOptions {
    //Компоненты, такие как кнопки
    components?: ActionRowBuilder[];

    //Что будет делать после отправки сообщения
    promise?: (msg: ClientMessage) => void;

    //Время через которое надо удалить сообщение
    time?: number;

    //Надо отвечать на это сообщение
    replied?: boolean;
}