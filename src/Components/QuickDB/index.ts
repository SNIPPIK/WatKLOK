import {Collection, Routes} from "discord.js";
import {readdirSync} from "fs";

//AudioPlayer
import {Collection as CollectionQueue} from "@components/AudioClient/Queue/Collection";
import {Filter} from "@components/AudioClient/Audio/AudioResource";

//Other
import {SuperClient} from "@components/Client";
import {httpsClient} from "@components/Request";
import {Command, Event, initDataDir} from "@handler";
import {API} from "@handler/APIs";
import {env, Logger} from "@env";
/**
 * @author SNIPPIK
 * @description Класс в котором хранятся команды
 * @class Commands
 * @private
 */
class Commands extends Collection<string, Command> {
    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() { return this.filter((command) => command.isOwner).toJSON(); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.filter((command) => !command.isOwner).toJSON(); };
}



/**
 * @author SNIPPIK
 * @description Все данные относящиеся к музыке
 * @class Music
 * @private
 */
class Music {
    private readonly _queue = new CollectionQueue();
    private readonly _filters: Filter[] = [];
    private readonly _platform = {
        supported: [] as API.load[],
        authorization: [] as API.platform[],
        audio: [] as API.platform[],
        block: [] as API.platform[]
    };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._platform; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this._queue; };

    /**
     * @description Получаем фильтры полученные из базы данных github
     * @return Filter[]
     * @public
     */
    public get filters() { return this._filters; };

    /**
     * @description Получаем фильтры из базы данных WatKLOK
     * @return Promise<Error | true>
     * @public
     */
    public get gettingFilters(): Promise<Error | true> {
        return new Promise<Error | true>(async (resolve, reject) => {
            const raw = await new httpsClient("https://raw.githubusercontent.com/SNIPPIK/WatKLOK/main/src/handlers/JSON/Filters.json", {useragent: true}).toJson;

            if (raw instanceof Error) return reject(raw);
            this._filters.push(...raw);

            return resolve(true);
        });
    };
}



/**
 * @author SNIPPIK
 * @class QuickDB
 * @description База данных бота
 */
export const db = new class QuickDB {
    /**
     * @description Получаем команды
     * @return Commands
     * @public
     */
    public get commands() { return this._commands; };
    private readonly _commands = new Commands();


    /**
     * @description Выдаем класс Music
     * @return Music
     * @public
     */
    public get music() { return this._music; };
    private readonly _music = new Music();


    /**
     * @description Загружаем команды для бота в Discord
     * @param client {SuperClient} Класс клиента
     * @return Promise<true>
     * @public
     */
    public registerApplicationCommands = (client: SuperClient): Promise<true> => {
        return new Promise<true>(async (resolve) => {
            //Загружаем все команды
            const PublicData: any = await client.rest.put(Routes.applicationCommands(client.user.id), {body: this.commands.public});
            const OwnerData: any = await client.rest.put(Routes["applicationGuildCommands"](client.user.id, env.get("owner.server")), {body: this.commands.owner});

            Logger.debug(`[Shard ${client.ID}]: [SlashCommands]: [Upload]: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            return resolve(true);
        });
    };

    /**
     * @description Загружаем Imports
     * @param client {SuperClient} Класс клиента
     * @return Promise<true>
     * @public
     */
    public initHandler = (client: SuperClient): Promise<true> => {
        return new Promise<true>((resolve) => {
            const dirs = ["Handler/APIs", "Handler/Commands", "Handler/Events"];

            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];

                try {
                    new initDataDir<API.load | Command | Event<unknown>>(dir, (data) => {
                        if (data instanceof Command) this._commands.set(data.name, data);
                        else if (data instanceof Event) client.on(data.name as any, (...args: any[]) => data.execute(client, ...args));
                        else {
                            //Надо ли авторизоваться на этой платформе
                            if (data.auth) {
                                //Если нет данных, то откидываем платформу
                                if (!env.get(`token.${data.name.toLowerCase()}`)) this.music.platforms.authorization.push(data.name);
                            }

                            //Поддерживает ли платформа получение аудио
                            if (!data.audio) this.music.platforms.audio.push(data.name);

                            this.music.platforms.supported.push(data);
                        }
                    });
                    Logger.log(`[Shard ${client.ID}] has initialize ${dir}`);
                } catch (err) {
                    Logger.error(err);
                    Logger.warn(`[Shard ${client.ID}] Fail loading ${dir}`);
                }
            }

            return resolve(true);
        });
    };
}