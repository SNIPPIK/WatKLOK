import { Client, IntentsBitField, Options, Collection, ActivityType } from "discord.js";
import { ClientMessage } from "@Client/interactionCreate";
import { Bot, Channels, APIs } from "@db/Config.json";
import { Command } from "@Handler/FileSystem/Handle/Command";
import { Player } from "@AudioPlayer/index";
import { FileSystem } from "src/_Handler/FileSystem";
import { CollectionQueue, Queue } from "@Queue/Queue";
import { Logger } from "@Logger";
import { env } from "src/_Handler/FileSystem/env";

const queue = new CollectionQueue<string | number, Queue>();
const commands = new Collection<string, Command>(); //База, со всеми командами
const player = new Player();

export class WatKLOK extends Client {
    /**
     * @description Все команды бота
     */
    public get commands() { return commands; };
    //====================== ====================== ====================== ======================
    /**
     * @description Все музыкальные очереди бота
     */
    public get queue() { return queue; };
    //====================== ====================== ====================== ======================
    /**
     * @description Плеер
     */
    public get player() { return player; };
    //====================== ====================== ====================== ======================
    /**
     * @description Текущий ID осколка
     */
    public get ShardID() { return this.shard?.ids[0] ?? undefined; };
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
            shards: "auto",
            presence: {
                activities: [{
                    name: "музыку",
                    type: ActivityType.Listening
                }]
            }
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
const client = new WatKLOK();

client.login().then((): void => {
    if (Bot.ignoreErrors) process.on("uncaughtException", (err) => {
        //Если выключено APIs.showErrors, то ошибки не будут отображаться
        if (!APIs.showErrors && err?.message?.match(/APIs/)) return;

        Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

        //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
        if (!APIs.sendErrors && err?.message?.match(/APIs/)) return;

        try {
            const channel = client.channels.cache.get(Channels.sendErrors) as ClientMessage["channel"];

            if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch(() => null);
        } catch {/* Continue */ }
    });
});