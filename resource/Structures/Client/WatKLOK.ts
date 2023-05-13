import {Client, Collection, IntentsBitField, Options} from "discord.js";
import {Command} from "@Client/Command";
import {Player} from "@AudioPlayer";
import {readdirSync} from "fs";
import {Logger} from "@Logger";
import {Event} from "@Client/Event";

const commands = new Collection<string, Command>();
const player = new Player();

export class WatKLOK extends Client {
    //====================== ====================== ====================== ======================
    /**
     * @description Плеер
     */
    public get player() { return player; };
    //====================== ====================== ====================== ======================
    /**
     * @description Все команды бота
     */
    public get commands() { return commands; };
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
    public login(token: string): Promise<string> {
        //Загружаем команды
        new initDataDir("data/Commands", "command").readDir();
        //Загружаем ивенты
        new initDataDir("data/Events", "event").readDir(this);

        return super.login(token);
    };
}

class initDataDir {
    private readonly path: string;
    private readonly type: "event" | "command";
    private file: string;

    //====================== ====================== ====================== ======================
    /**
     * @description Загружаем первый экспорт из файла
     */
    private get loadFile() {
        const importFile = require(`../../../${this.path}/${this.file}`);
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
    };
    public constructor(path: string, type: "event" | "command") { this.path = path; this.type = type; };
    //====================== ====================== ====================== ======================
    /**
     * @description Начинаем чтение и загрузку команда или ивентов
     * @param client {WatKLOK} Клиент
     */
    public readonly readDir = (client?: WatKLOK) => {
        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;

            readdirSync(`${this.path}/${dir}/`).forEach((file) => {
                if (!file.endsWith(".js")) return;
                let reason = null;

                try {
                    this.file = `${dir}/${file}`;
                    const hasLoad: Command | Event<any, any> = this.loadFile;

                    //Добавляем ошибки если они как таковые есть
                    if (!hasLoad) reason = "Not found exports";
                    else if (!hasLoad.isEnable) reason = "Parameter isEnable has false";
                    else if (!hasLoad.run) reason = "Function run has not found";

                    //Если при загрузке произошла ошибка
                    if (hasLoad instanceof Error) reason = hasLoad.message;
                    if ("type" in hasLoad) hasLoad.type = dir; //Если есть type в pull

                    //Удаляем данные которые больше не нужны
                    delete hasLoad.isEnable;

                    if (this.type === "command") { //Загружаем команду
                        if (reason) return Logger.error(`[Command]: [${hasLoad.name}]: ${reason}!`);
                        else if (!hasLoad.name) return Logger.error(`[Command]: [${hasLoad.name}]: Not found name!`);

                        commands.set(hasLoad.name, hasLoad as Command);
                    } else { //Загружаем ивент
                        if (reason) return Logger.error(`[Event]: [${hasLoad.name}]: ${reason}!`);
                        else if (!hasLoad.name) return Logger.error(`[Event]: [${hasLoad.name}]: Not found name!`);

                        //@ts-ignore
                        client.on(hasLoad.name, (f, v) => hasLoad.run(f, v, client));
                    }
                } catch (e) { Logger.error(e); }
            });
        });
    }
}