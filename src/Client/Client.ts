import {ActivityType, Client, IntentsBitField, Options, Collection} from "discord.js";
import {DurationUtils} from "@Managers/DurationUtils";
import {ClientMessage} from "@Client/interactionCreate";
import {Bot, Channels, APIs} from "@db/Config.json";
import {Command} from "@Structures/Handle/Command";
import {Player} from "@AudioPlayer/index";
import {FileSystem} from "@FileSystem";
import {Queue} from "@Queue/Queue";
import {env} from "@env";

export function consoleTime(data: string) {
    const date = new Date();
    const reformatDate = [date.getHours(), date.getMinutes(), date.getSeconds()].map(DurationUtils.toFixed0);

    if (client.ShardID) return console.log(`[ShardID: ${client.ShardID}]: [${reformatDate.join(":")}.${date.getMilliseconds()}] ${data}`);
    return console.log(`[${reformatDate.join(":")}.${date.getMilliseconds()}] ${data}`);
}

const queue = new Collection<string, Queue>();
const commands = new Collection<string, Command>(); //База, со всеми командами

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
    public get player() { return Player; };
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
            sweepers: { ...Options.DefaultSweeperSettings,
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
                IntentsBitField.Flags.Guilds,
                //IntentsBitField.Flags.GuildMembers,

            ],
            ws: { properties: { browser: "Web" as "Discord iOS" | "Web" } },
            presence: {
                activities: [{
                    name: "Music 🎶",
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

client.login().then(() => {
    if (Bot.ignoreErrors) process.on("uncaughtException", (err) => {
        //Если выключено APIs.showErrors, то ошибки не будут отображаться
        if (!APIs.showErrors && err?.message?.match(/APIs/)) return;

        consoleTime(`[IgnoreError]: ${err.name} | ${err.message}\n${err.stack}`);

        //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
        if (!APIs.sendErrors && err?.message?.match(/APIs/)) return;

        try {
            const channel = client.channels.cache.get(Channels.sendErrors) as ClientMessage["channel"];

            if (channel) channel.send({content: `\`\`\`ts\nError: ${err.message}\nType: ${err.name}\n\nFull Error: ${err.stack}\n\`\`\``}).catch(() => null);
        } catch {/* Continue */}
    });
});