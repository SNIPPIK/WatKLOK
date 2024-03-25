import {ActionRow, ActionRowBuilder,  Attachment, BaseInteraction, BaseMessageOptions, Client as DS_Client, EmbedData, GuildMember, IntentsBitField,Message,MessagePayload, Partials, ShardingManager, User, WebhookClient, WebhookMessageCreateOptions } from "discord.js";
import {threadId} from "node:worker_threads";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class Client
 * @public
 */
export class Client extends DS_Client {
    private readonly webhook = new WebhookClient({id: "1218644515569532958", token: "H7aN-FhmQsp92Way-r-HrsKKEaYJXRd0hLOOhHLS1xncw8h2lkMMcruTSVueG8WN8S0M"});
    /**
     * @description Получаем ID осколка
     * @return number
     * @public
     */
    public get ID() { return typeof this.shard?.ids[0] === "string" ? 0 : this.shard?.ids[0] ?? 0; };

    /**
     * @description Отправляем данные через систему Webhook
     * @param options - Данные для отправки
     * @public
     */
    public set sendWebhook(options: WebhookMessageCreateOptions) {
        this.webhook.send(options).catch(() => {});
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
            shardCount: parseInt(env.get("shard.server")) || 1e3,
            shards: "auto",
        });
    };
}

/**
 * @author SNIPPIK
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 * @class ShardManager
 * @public
 */
export class ShardManager extends ShardingManager {
    public constructor(path: string) {
        const mode = env.get("shard.mode");
        super(path, { token: env.get("token.discord"), mode, respawn: true, totalShards: env.get("shard.total"), execArgv: ["-r", "tsconfig-paths/register"] });

        process.title = "ShardManager";
        Logger.log("LOG", `[ShardManager/${mode}] running...`);

        //Слушаем ивент для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log("LOG",`[Shard ${shard.id}] added to manager`));
            shard.on("ready", () => Logger.log("LOG",`[Shard ${shard.id}] is running`));
            shard.on("death", () => Logger.log("LOG",`[Shard ${shard.id}] is killed`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[ShardManager]: ${err}`));
    };
}

/**
 * @author SNIPPIK
 * @description Здесь хранятся данные выдаваемые от discord
 * @namespace Client
 */
export namespace Client {
    /**
     * @author SNIPPIK
     * @class interact
     * @description Структура сообщения с тестового канала вызванная через "/"
     */
    // @ts-ignore
    export interface interact extends BaseInteraction {
        client: Client;
        member: GuildMember; customId: string; commandName: string; author: User;
        deferReply: () => Promise<void>; deleteReply: () => Promise<void>;
        options?: {
            _group?: string;
            _subcommand?: string;
            _hoistedOptions: any[];
            getAttachment?: (name: string) => Attachment
        };
        reply: message["channel"]["send"];
        replied?: boolean;
        followUp: interact["reply"];
    }

    /**
     * @author SNIPPIK
     * @class message
     * @description Структура сообщения с текстового канала
     */
    // @ts-ignore
    export interface message extends Message {
        client: Client;
        channel: { send(options: SendMessageOptions & { fetchReply?: boolean }): Promise<message> };
        edit(content: SendMessageOptions): Promise<message>
        reply(options: SendMessageOptions): Promise<message>
        user: null;
    }

    /**
     * @description Аргументы для отправки сообщения
     */
    type SendMessageOptions = string | MessagePayload | BaseMessageOptions | {
        embeds?: EmbedData[],
        components?: ActionRow<any> | ActionRowBuilder<any>
    };
}













const debug = env.get("debug");
/**
 * @author SNIPPIK
 * @description Простенький logger
 * @public
 */
export const Logger = new class {
    private readonly status = {
        "DEBUG": "\x1b[34mi\x1b[0m",
        "WARN": "\x1b[33mi\x1b[0m",
        "ERROR": "\x1b[31mi\x1b[0m",
        "LOG": "\x1b[32mi\x1b[0m"
    };
    private readonly colors = {
        "DEBUG": "\x1b[90m",
        "WARN": "\x1b[33m",
        "ERROR": "\x1b[31m",
        "LOG": ""
    };

    /**
     * @description Отправляем лог с временем
     * @param status {string} Статус лога
     * @param text {string} Текст лога
     */
    public log = (status: "DEBUG" | "WARN" | "ERROR" | "LOG", text: string): void => {
        if (status === "DEBUG" && !debug || !(typeof text?.replace === 'function')) return;

        text = text.replace(/\[/g, "\x1b[100m \x1b[30m").replace(/]/g, " \x1b[0m");

        const extStatus = this.status[status];
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;
        const spaces = 130 - (extStatus.length + text.length) - (time.length);
        const extText = spaces < 0 ? `${text}\x1b[0m` : `${text}\x1b[0m${" ".repeat(spaces) + time}`;

        console.log(`\x1b[35m${threadId} |\x1b[0m ${extStatus} `  + `${this.colors[status]}${extText}`);
    };
}