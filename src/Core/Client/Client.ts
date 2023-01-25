import {ActivityType, Client, IntentsBitField, Options, SnowflakeUtil} from "discord.js";
import {DurationUtils} from "@AudioPlayer/Managers/DurationUtils";
import {ClientMessage} from "@Client/interactionCreate";
import {Bot, Channels, APIs} from "@db/Config.json";
import {Command} from "@Structures/Handle/Command";
import {Player} from "@AudioPlayer/index";
import {LoadFiles} from "@FileSystem";
import {Queue} from "@Queue/Queue";
import {env} from "@env";

export function consoleTime(data: string) {
    const date = new Date();
    const reformatDate = [date.getHours(), date.getMinutes(), date.getSeconds()].map(DurationUtils.toFixed0);

    return console.log(`[${reformatDate.join(":")}.${date.getMilliseconds()}] ${data}`);
}

class CollectionMap<K, V> extends Map<K, V> {
    public get Array(): V[] | null {
        const db: V[] = [];
        for (const [, value] of this.entries()) db.push(value);

        return db;
    };
}

//Удаляем данные старше 25 минут
function DefaultKeepOverLimit<V, K, J>(value: V) { //key: K, collection: J
    return SnowflakeUtil.timestampFrom((value as any).channelId) < Date.now() - 25e5;
}

export class WatKLOK extends Client {
    private readonly _queue = new CollectionMap<string, Queue>();
    private readonly _commands = new CollectionMap<string, Command>(); //База, со всеми командами
    private readonly _player = Player; //Плеер
    private readonly _ShardID = this.shard?.ids[0] ?? undefined; //Если запущен ShardManager, будет отображаться номер дубликата

    public get commands() { return this._commands; };
    public get queue() { return this._queue; };
    public get player() { return this._player; };
    public get ShardID() { return this._ShardID; };

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
                GuildScheduledEventManager: 0,

                //Что надо чистить
                VoiceStateManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                },
                MessageManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                },
                ReactionManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                },
                ReactionUserManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                },
                GuildEmojiManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                },
                BaseGuildEmojiManager: {
                    maxSize: Infinity,
                    keepOverLimit: DefaultKeepOverLimit
                }
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
                    name: "музыку в youtube, spotify, soundcloud, vk",
                    type: ActivityType.Listening
                }]
            }
        });
    };
    //Включаем бота
    public login(token: string = env.get("TOKEN")): Promise<string> {
        LoadFiles(this);

        return super.login(token);
    };
}
const client = new WatKLOK();

client.login().then(() => {
    if (Bot.ignoreErrors) process.on("uncaughtException", (err) => {
        if (!APIs.showErrors && err?.message?.match(/APIs/)) return;

        consoleTime(`[IgnoreError]: ${err.name} | ${err.message}\n${err.stack}`);

        if (!APIs.sendErrors && err?.message?.match(/APIs/)) return;

        try {
            const channel = client.channels.cache.get(Channels.sendErrors) as ClientMessage["channel"];

            if (channel) channel.send({content: `\`\`\`ts\nError: ${err.message}\nType: ${err.name}\n\nFull Error: ${err.stack}\n\`\`\``}).catch(() => null);
        } catch {/* Continue */}
    });
})