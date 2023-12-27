import {Client, IntentsBitField, Partials} from "discord.js";
import {db} from "@components/QuickDB";
import {env, Logger} from "@env";
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