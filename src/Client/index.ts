import {
    ActionRowBuilder,
    ApplicationCommandOption,
    Client,
    ClientEvents,
    Collection,
    Colors,
    CommandInteraction,
    EmbedData,
    IntentsBitField,
    MessageReaction,
    Partials,
    PermissionResolvable,
    ShardingManager
} from "discord.js";
import {ClientMessage, ClientInteraction} from "@handler/Events/Atlas/interactionCreate";
import {Logger} from "@src";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @class Atlas
 */
class Atlas extends Client {
    /**
     * @description Получаем ID осколка
     * @return number
     * @public
     */
    public get ID() {
        return typeof this.shard?.ids[0] === "string" ? 0 : this.shard?.ids[0] ?? 0;
    };

    /**
     * @description Создаем класс бота и затем запускаем
     * @public
     */
    public constructor() {
        super({
            allowedMentions: {
                parse: ["roles", "users"],
                repliedUser: true,
            },
            intents: [
                IntentsBitField.Flags["GuildMessages"],
                IntentsBitField.Flags["DirectMessages"],
                IntentsBitField.Flags["GuildMessageReactions"],
                IntentsBitField.Flags["DirectMessageReactions"],
                IntentsBitField.Flags["GuildEmojisAndStickers"],
                IntentsBitField.Flags["GuildIntegrations"],
                IntentsBitField.Flags["GuildVoiceStates"],
                IntentsBitField.Flags["Guilds"]
            ],
            partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
            shards: "auto"
        });
    };
}

/**
 * @author SNIPPIK
 * @class ShardManager
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 */
class ShardManager extends ShardingManager {
    public constructor(path: string) {
        super(path, { token: env.get("token.discord"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        process.title = "ShardManager";
        Logger.log(`[ShardManager] has starting`);

        //Слушаем ивент для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log(`[Shard ${shard.id}] has added to manager`));
            shard.on("ready", () => Logger.log(`[Shard ${shard.id}] has a running`));
            shard.on("death", () => Logger.log(`[Shard ${shard.id}] has killed`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };
}










/**
 * @author SNIPPIK
 * @class ActionMessageBase
 * @description База класса ActionMessage
 */
class ActionMessageBase {
    protected readonly _options: ActionType.content | ActionType.embeds | ActionType.menu;

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
     * @description Создаем меню с объектами
     * @param message {ClientMessage}
     * @return void
     */
    private _createMenu = (message: ClientMessage) => {
        let {page, pages, callback} = this._options as ActionType.menu;

        for (const [key, emoji] of Object.entries({back: "⬅️", cancel: "🗑", next: "➡️"})) {
            message.react(emoji).then(() => {
                message.createReactionCollector({
                    filter: (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id,
                    time: 60e3
                }).on("collect", ({users}: MessageReaction): void => {
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
                });
            });
        }
    };

    public constructor(options: ActionType.content | ActionType.embeds | ActionType.menu) {
        //Создаем Embed сообщение
        if ("content" in options && !("page" in options)) {
            const {color, content, codeBlock, message, time, replied, promise, components} = options;

            options = {
                message, time: time, replied, promise, components,
                embeds: [{
                    color: typeof color === "number" ? color : Colors[color] ?? 258044,
                    description: codeBlock ? `\`\`\`${codeBlock}\n${content}\n\`\`\`` : content
                }]
            }
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
        }).catch((err): void => void process.emit("uncaughtException", err));
    };
}


/**
 * @author SNIPPIK
 * @class ActionMessage
 * @description Отправляем сообщение в текстовый канал Discord
 */
export class ActionMessage extends ActionMessageBase {
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
 * @description Загрузка команд
 * @class Command
 * @abstract
 */
abstract class Command {
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
    public readonly execute: (message: ClientMessage | ClientInteraction, args?: string[]) => ActionType.command | Promise<ActionType.command> | void;
}

/**
 * @author SNIPPIK
 * @description Класс для событий
 * @class Event
 * @abstract
 */
abstract class Event<T> {
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
 * @description Класс в котором хранятся команды
 * @class Commands
 * @private
 */
export class Commands extends Collection<string, Command> {
    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() { return this.filter((command) => command.owner).toJSON(); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.filter((command) => !command.owner).toJSON(); };
}

/**
 * @description Exported classes
 */
export {Atlas, Event, Command, ShardManager};


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