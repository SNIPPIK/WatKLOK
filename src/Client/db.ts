import {Collection as AudioCollection} from "@watklok/player/collection";
import {Command, Event, API, RequestAPI, loadHandlerDir} from "@handler";
import {Filter} from "@watklok/player/AudioPlayer";
import {Collection, Routes} from "discord.js";
import {httpsClient} from "@watklok/request";
import {Atlas, Logger} from "@Client";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class QuickDB
 * @description База данных бота
 * @public
 */
export class db {
    private static readonly _emojis = {
        button: {
            resume: env.get("button.resume"),
            pause: env.get("button.pause"),
            loop: env.get("button.loop"),
            loop_one: env.get("button.loop_one"),
            pref: env.get("button.pref"),
            next: env.get("button.next"),
            queue: env.get("button.queue")
        },

        progress: {
            empty: {
                left: env.get("progress.empty.left"),
                center: env.get("progress.empty.center"),
                right: env.get("progress.empty.right")
            },
            upped: {
                left: env.get("progress.not_empty.left"),
                center: env.get("progress.not_empty.center"),
                right: env.get("progress.not_empty.right")
            },
            bottom: env.get("progress.bottom")
        },
        noImage: env.get("image.not"),
        diskImage: env.get("image.currentPlay")
    };
    private static readonly _array = {
        /**
         * @author SNIPPIK
         * @description Класс в котором хранятся команды
         * @private
         */
        commands: new class extends Collection<string, Command> {
            /**
             * @description Команды для разработчика
             * @return Command[]
             * @public
             */
            public get owner() { return this.filter((command) => command.owner).toJSON(); };

            /**
             * @description Команды доступные для всех
             * @return Command[]
             * @public
             */
            public get public() { return this.filter((command) => !command.owner).toJSON(); };
        },
        queue: new AudioCollection(),
        filters: [] as Filter[],
        platforms: {
            supported: [] as RequestAPI[],
            authorization: [] as API.platform[],
            audio: [] as API.platform[],
            block: [] as API.platform[]
        }
    };
    private static readonly _audio = {
        volume:  parseInt(env.get("audio.volume")),
        fade:    parseInt(env.get("audio.fade")),
        bitrate: env.get("audio.bitrate")
    };
    /**
     * @description Выдаем данные для запуска AudioResource
     * @public
     */
    public static get AudioOptions() { return this._audio; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public static get queue() { return this._array.queue; };

    /**
     * @description Получаем фильтры полученные из базы данных github
     * @return Filter[]
     * @public
     */
    public static get filters() { return this._array.filters; };

    /**
     * @description Получаем фильтры из базы данных WatKLOK
     * @return Promise<Error | true>
     * @public
     */
    private static get getFilters(): Promise<Error | true> {
        return new Promise<Error | true>(async (resolve, reject) => {
            const raw = await new httpsClient(env.get("filters.url"), {useragent: true}).toJson;

            if (raw instanceof Error) return reject(raw);
            this._array.filters.push(...raw);

            return resolve(true);
        });
    };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public static get platforms() { return this._array.platforms; };

    /**
     * @description Выдаем класс с командами
     * @public
     */
    public static get commands() { return this._array.commands; };

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public static get emojis() { return this._emojis; };

    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    private static registerCommands = (client: Atlas): Promise<boolean> => {
        return new Promise<true>(async (resolve) => {
            //Загружаем все команды
            const PublicData: any = await client.rest.put(Routes.applicationCommands(client.user.id), {body: this.commands.public});
            const OwnerData: any = await client.rest.put(Routes["applicationGuildCommands"](client.user.id, env.get("owner.server")), {body: this.commands.owner});

            Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands] ${PublicData.length}/${OwnerData.length}`);
            return resolve(true);
        });
    };

    /**
     * @description Загружаем Imports
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    private static initFs = async (client: Atlas): Promise<void> => {
        const dirs = ["Handlers/APIs", "Handlers/Commands", "Handlers/Events"];
        const callbacks = [
            (item: RequestAPI) => {
                //Если нет данных, то откидываем платформу
                if (!item.auth) this.platforms.authorization.push(item.name);

                //Поддерживает ли платформа получение аудио
                if (!item.audio) this.platforms.audio.push(item.name);

                this.platforms.supported.push(item);
            },
            (item: Command) => this.commands.set(item.name, item),
            (item: Event<any>) => {
                if (item.type === "client") client.on(item.name as any, (...args: any[]) => item.execute(client, ...args)); // @ts-ignore
                else this.queue.events.on(item.name as any, (...args: any[]) => item.execute(...args));
            }
        ];

        //Постепенно загружаем директории с данными
        for (let n = 0; n < dirs.length; n++) {
            const path = dirs[n];

            try {
                new loadHandlerDir<any>(path, callbacks[n]);
                Logger.log("LOG", `[Shard ${client.ID}] have been uploaded, ${path}`);
            } catch (err) { Logger.log("ERROR", err); }
        }
    };

    /**
     * @description Запускаем db
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    public static initHandler = async (client: Atlas): Promise<void> => {
        Logger.log("LOG", `[Shard ${client.ID}] is initialize database`);

        //Проверяем статус получения фильтров
        const filterStatus = await this.getFilters;
        if (filterStatus instanceof Error) Logger.log("ERROR", `[Shard ${client.ID}] is initialize filters`);
        else Logger.log("LOG", `[Shard ${client.ID}] is initialize filters`);

        //Загружаем под папки в Handlers
        await this.initFs(client); await this.registerCommands(client);
    };
}