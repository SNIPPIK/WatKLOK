import { Client, IntentsBitField, Options, Collection } from "discord.js";
import { FileSystem } from "@Structures/FileSystem";
import { Command } from "@Structures/Handlers";
import { Player } from "@AudioPlayer";
import { env } from "@Fs";

const commands = new Collection<string, Command>(); //База, со всеми командами
const AudioPlayer = new Player();

export class WatKLOK extends Client {
    /**
     * @description Все команды бота
     */
    public get commands() { return commands; };
    //====================== ====================== ====================== ======================
    /**
     * @description Плеер
     */
    public get player() { return AudioPlayer; };
    //====================== ====================== ====================== ======================
    /**
     * @description Текущий ID осколка
     */
    public get shardID() { return this.shard?.ids[0] ?? undefined; };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем класс бота и затем запускаем
     */
    public constructor() {
        super({
            sweepers: {
                ...Options.DefaultSweeperSettings,
                messages: {
                    interval: 1800, // Every 30 min...
                    lifetime: 900	// 15 minutes.
                }
            },
            //Запрещаем Discord.js<Client> кешировать некоторые данные
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
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
                //IntentsBitField.Flags.GuildMembers,

            ],
            shards: "auto"
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Немного меняем djs<Client.login>
     * @param token {string} Токен, по умолчанию будет взят из env.TOKEN
     */
    public login(token: string = env.get("TOKEN")): Promise<string> {
        FileSystem.initFileSystem(this);

        return super.login(token);
    };
}