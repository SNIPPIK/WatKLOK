import {Client, Colors, CommandInteraction, IntentsBitField, MessageReaction, Partials} from "discord.js";
import {env, Logger} from "@env";
import {db} from "@Client/db";
import {ActionType} from "@handler";
import {ClientMessage} from "@handler/Events/Client/interactionCreate";
/**
 * @author SNIPPIK
 * @class SuperClient
 */
export class SuperClient extends Client {
    /**
     * @description Получаем ID осколка
     * @return number
     * @public
     */
    public get ID() {
        return typeof this.shard?.ids[0] === "string" ? 0 : this.shard?.ids[0] ?? 0;
    };

    /**
     * @description Запускаем бота
     * @param token {string} Токен бота, по умолчанию env<token.discord>
     * @return Promise<string>
     * @public
     */
    public asyncLogin = async (token: string = env.get("token.discord")): Promise<string> => {
        this.once("ready", async () => {
            Logger.log(`[Shard ${this.ID}] has connected for websocket`);

            for (const status of [await db.music.gettingFilters, await db.initHandler(this), await db.registerApplicationCommands(this)]) {
                if (status instanceof Error) throw status;
            }
        });

        return super.login(token);
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