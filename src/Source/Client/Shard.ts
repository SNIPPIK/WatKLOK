import {Client, IntentsBitField, Options} from "discord.js";
import {Player} from "@AudioPlayer";
import {db} from "../db";

const player = new Player();
const DefaultLifeTime = {
    interval: 1800, // Every 30 min...
    lifetime: 900	// 15 minutes.
};

export class WatKLOK extends Client {
    /**
     * @description Плеер
     */
    public get player() { return player; };


    /**
     * @description Все команды бота
     */
    public get commands() { return db.commands; };


    /**
     * @description Создаем класс бота и затем запускаем
     */
    public constructor() {
        super({
            sweepers: {
                ...Options.DefaultSweeperSettings,
                messages: DefaultLifeTime
            },
            //Запрещаем Discord.js<Client> кешировать некоторые данные
            makeCache: Options.cacheWithLimits({
                AutoModerationRuleManager: 0,

                //Бот не может менять статус
                PresenceManager: 0,

                //Боту недоступны стикеры
                GuildStickerManager: 0,

                //Бот не может использовать бан
                GuildBanManager: 0,

                //Боту не доступны форумы
                GuildForumThreadManager: 0,

                //Боту недоступны роли
                StageInstanceManager: 0,

                //Боту недоступна функция создания приглашений
                GuildInviteManager: 0,

                //Боту будет недоступен ивент guildScheduledEventCreate
                GuildScheduledEventManager: 0
            }),
            intents: [
                //Message (Бот может писать в текстовые каналы)
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.DirectMessages,

                //Reaction (Бот может ставить emoji)
                IntentsBitField.Flags.GuildMessageReactions,
                IntentsBitField.Flags.DirectMessageReactions,

                //Emoji and stickers (Бот может получать данные о emoji или стакерах)
                IntentsBitField.Flags.GuildEmojisAndStickers,

                //Slash Commands (Пользователям доступны slash команды)
                IntentsBitField.Flags.GuildIntegrations,

                //Default Commands (Бот может читать сообщение пользователей)
                IntentsBitField.Flags.MessageContent,

                //Voice (Бот может получить данные кто находится в голосовом канале)
                IntentsBitField.Flags.GuildVoiceStates,

                //Guild (Бот может получить данные о серверах)
                IntentsBitField.Flags.Guilds
            ],
            shards: "auto"
        });
    };


    /**
     * @description Немного меняем djs<Client.login>
     * @param token {string} Токен, по умолчанию будет взят из env.TOKEN
     */
    public login(token: string): Promise<string> {
        db.initCommands = "Data/Commands";
        db.initActions = {dir: "Data/Actions", client: this};
        db.initPlatforms();

        const login = super.login(token);
        login.then(() => {
            db.initSlashCommands = {token, userID: this.user.id};
        });

        return login;
    };
}