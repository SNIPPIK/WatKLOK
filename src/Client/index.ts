import {Client, IntentsBitField, Partials, ShardingManager} from "discord.js";
import {env} from "@env";
const debug = env.get("debug");
/**
 * @author SNIPPIK
 * @class Atlas
 */
export class Atlas extends Client {
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
export class ShardManager extends ShardingManager {
    public constructor(path: string) {
        super(path, { token: env.get("token.discord"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        process.title = "ShardManager";
        Logger.log("LOG", `[ShardManager] has starting`);

        //Слушаем ивент для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log("LOG",`[Shard ${shard.id}] has added to manager`));
            shard.on("ready", () => Logger.log("LOG",`[Shard ${shard.id}] has a running`));
            shard.on("death", () => Logger.log("LOG",`[Shard ${shard.id}] has killed`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[ShardManager]: ${err}`));
    };
}


/**
 * @author SNIPPIK
 * @class Logger
 * @description Простенький logger
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
    }

    /**
     * @description Отправляем лог с временем
     * @param status {string} Статус лога
     * @param text {string} Текст лога
     */
    public log = (status: "DEBUG" | "WARN" | "ERROR" | "LOG", text: string): void => {
        if (status === "DEBUG" && !debug) return;

        text = text.replace(/\[/, "\x1b[42m \x1b[30m").replace(/]/, " \x1b[0m");

        const extStatus = this.status[status];
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;
        const spaces = 130 - (extStatus.length + text.length) - (time.length);
        const extText = spaces < 0 ? `${text}\x1b[0m` : `${text}\x1b[0m${" ".repeat(spaces) + time}`;

        console.log(`\x1b[35m|\x1b[0m ${extStatus} `  + `${this.colors[status]}${extText}`);
    };
}