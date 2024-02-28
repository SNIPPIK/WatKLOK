import {ClientInteraction, ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ActionRowBuilder, Colors, CommandInteraction, EmbedData} from "discord.js";
import {Logger} from "@Client";

/**
 * @author SNIPPIK
 * @description Конструкторы сообщений
 */
namespace Constructors {
    /**
     * @description Конструктор меню
     */
    export interface menu {
        content?:       string;
        embeds?:        EmbedData[];
        pages:          string[];
        page:           number;
        callback:       (message: ClientMessage, pages: string[], page: number) => void;
    }

    /**
     * @description Конструктор сообщения, отправка текстового сообщения в embed
     */
    export interface simple {
        color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
        codeBlock?:     string;
        content:        string;
    }

    /**
     * @description Конструктор embeds, отправка своих embeds
     */
    export interface embeds {
        embeds:         EmbedData[];
    }

    /**
     * @description Дополнительные параметры для отправки
     */
    export interface main {
        promise?:       (msg: ClientMessage) => void;
        components?:    ActionRowBuilder[];
        replied?:       boolean;
        time?:          number;
    }
}

/**
 * @description Допустимые параметры данных
 * @class MessageConstructor
 */
export type MessageConstructorType = (Constructors.menu | Constructors.embeds | Constructors.simple) & Constructors.main;

/**
 * @author SNIPPIK
 * @description Создает сообщения для отправки на Discord
 * @class MessageConstructor
 */
export class MessageConstructor {
    private readonly _options: MessageConstructorType & { message?: ClientMessage | ClientInteraction; fetchReply?: boolean } = {time: 15e3, embeds: null, fetchReply: true };
    public constructor(options: MessageConstructor["_options"]) {
        Object.assign(this._options, options);
        const {time, promise} = options;

        //Отправляем сообщение
        this.channel.then((message) => {
            //Удаляем сообщение через время если это возможно
            if (time !== 0) MessageConstructor.delete = {message, time};

            //Если получить возврат не удалось, то ничего не делаем
            if (!message) return;

            //Если надо выполнить действия после
            if (promise) promise(message);

            //Если меню, то не надо удалять
            if ("page" in options) this._createMenu(message);
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
     * @description Удаление сообщения через указанное время
     * @param options - Параметры для удаления сообщения
     */
    public static set delete(options: { message: CommandInteraction | ClientMessage, time?: number }) {
        const {message, time} = options;

        //Удаляем сообщение
        setTimeout(() => {
            if ("deletable" in message && message.deletable) {
                message.delete().catch((err) => Logger.log("WARN", err));
            } else if ("replied" in message && !(message as any).replied) {
                (message as CommandInteraction)?.deleteReply().catch((err) => Logger.log("WARN", err))
            }
        }, time ?? 15e3);
    };

    /**
     * @description Создаем меню с объектами
     * @param message - Сообщение пользователя
     * @return void
     */
    private _createMenu = (message: ClientMessage) => {
        let {page, pages, callback} = this._options as Constructors.menu;

        for (const [key, emoji] of Object.entries({back: "⬅️", cancel: "🗑", next: "➡️"})) {
            message.react(emoji).then(() => message.createReactionCollector({time: 60e3,
                filter: (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id
            }).on("collect", ({users}): void => {
                users.remove(this._options.message.author).catch(() => null);

                //Удаляем сообщение
                if (key === "cancel") MessageConstructor.delete = {message, time: 2e3};

                //Если нельзя поменять страницу
                else if (page === pages.length || page < 1) return;

                //Выбираем что делать со страничкой, пролистать вперед или назад
                else if (key === "next") page++;
                else page--;

                //Возвращаем функцию
                return callback(message, pages, page);
            }));
        }
    };
}