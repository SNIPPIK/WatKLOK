import type {
    ActionRow,
    ActionRowBuilder,
    Attachment,
    BaseInteraction,
    BaseMessageOptions,
    EmbedData,
    GuildMember,
    Message,
    User,
    WebhookMessageCreateOptions
} from "discord.js";
import {
    Client as DS_Client,
    IntentsBitField,
    MessagePayload,
    Partials,
    ShardingManager,
    WebhookClient
} from "discord.js";
import type {LocalizationMap} from "discord-api-types/v10";
import {env, Logger} from "@env";

/**
 * @author SNIPPIK
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 * @class ShardManager
 * @public
 */
export class ShardManager extends ShardingManager {
    public constructor(path: string) {
        super(path, {
            token: env.get("token.discord"), mode: "worker",
            totalShards: env.get("shard.total"),
            execArgv: ["-r", "tsconfig-paths/register"],
            respawn: true
        });
        Logger.log("LOG", `[ShardManager/worker] running...`);

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
 * @class Client
 * @public
 */
export class Client extends DS_Client {
    private readonly webhook = env.get("webhook.id") && env.get("webhook.token") ?
        new WebhookClient({id: env.get("webhook.id"), token: env.get("webhook.token")}) : null;
    public constructor() {
        super({
            allowedMentions: {
                parse: ["roles", "users"],
                repliedUser: true,
            },
            intents: [
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
        if (this.webhook) this.webhook.send(options).catch(() => {
            Logger.log("WARN", "Fail to send webhook data for discord channel!");
        });
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
     * @type client_edited
     * @description Поддержка последних данных для interact и message
     * @description Поддержка последних данных для interact и message
     */
    type client_edited = {
        client: Client; member: GuildMember; author: User;
        locale: keyof LocalizationMap;

        reply(options: SendMessageOptions & { fetchReply?: boolean }): Promise<message>;
    };

    /**
     * @author SNIPPIK
     * @class interact
     * @description Структура сообщения с тестового канала вызванная через "/"
     */
    // @ts-ignore
    export interface interact extends client_edited, BaseInteraction {
        customId: string; commandName: string; deferred: boolean; replied?: boolean;
        options?: {
            _group?: string;
            _subcommand?: string;
            _hoistedOptions: any[];
            getAttachment?: (name: string) => Attachment
        };

        deferReply: () => Promise<void>; deleteReply: () => Promise<void>;
        followUp: interact["reply"]; editReply: interact["reply"];
    }

    /**
     * @author SNIPPIK
     * @class message
     * @description Структура сообщения с текстового канала
     */
    // @ts-ignore
    export interface message extends client_edited, Message {
        channel: { send: message["reply"] }; edit: message["reply"]; user: null;
    }

    /**
     * @description Аргументы для отправки сообщения
     */
    type SendMessageOptions = string | MessagePayload | BaseMessageOptions | {
        embeds?: EmbedData[],
        components?: ActionRow<any> | ActionRowBuilder<any>
    };
}