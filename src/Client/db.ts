import {Collection as AudioCollection} from "@Client/Audio/Queue/Collection";
import {Filter} from "@Client/Audio/Player/AudioResource";
import {Command, Event, API, RequestAPI} from "@handler";
import {Collection, Routes} from "discord.js";
import {httpsClient} from "@Client/Request";
import {Atlas, Logger} from "@Client";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class QuickDB
 * @description База данных бота
 */
export const db = new class QuickDB {
    private readonly _emojis = {
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
    private readonly _array = {
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
    /**
     * @description Выдаем класс с командами
     * @public
     */
    public get commands() { return this._array.commands; };

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public get emojis() { return this._emojis; };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._array.platforms; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this._array.queue; };

    /**
     * @description Получаем фильтры полученные из базы данных github
     * @return Filter[]
     * @public
     */
    public get filters() { return this._array.filters; };

    /**
     * @description Получаем фильтры из базы данных WatKLOK
     * @return Promise<Error | true>
     * @public
     */
    private get getFilters(): Promise<Error | true> {
        return new Promise<Error | true>(async (resolve, reject) => {
            const raw = await new httpsClient(env.get("filters.url"), {useragent: true}).toJson;

            if (raw instanceof Error) return reject(raw);
            this._array.filters.push(...raw);

            return resolve(true);
        });
    };

    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    private registerCommands = (client: Atlas): Promise<true> => {
        return new Promise<true>(async (resolve) => {
            //Загружаем все команды
            const PublicData: any = await client.rest.put(Routes.applicationCommands(client.user.id), {body: this.commands.public});
            const OwnerData: any = await client.rest.put(Routes["applicationGuildCommands"](client.user.id, env.get("owner.server")), {body: this.commands.owner});

            Logger.log("DEBUG", `[Shard ${client.ID}]: [SlashCommands]: [Upload]: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            return resolve(true);
        });
    };

    /**
     * @description Загружаем Imports
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    private initFs = async (client: Atlas) => {
        const dirs = ["Handlers/APIs", "Handlers/Commands", "Handlers/Events"];

        //Постепенно загружаем директории с данными
        for (let n = 0; n < dirs.length; n++) {
            const path = dirs[n];

            try {
                new loadHandlerDir<RequestAPI | Command | Event<unknown>>(path, (item, file) => {

                    //Загружаем команды
                    if (item instanceof Command) this.commands.set(item.name, item);

                    //Загружаем ивенты
                    else if (item instanceof Event) {
                        if (item.type === "client") client.on(item.name as any, (...args: any[]) => item.execute(client, ...args));
                        else if (item.type === "process") process.on(item.name as any, item.execute);
                    }

                    //Загружаем APIs
                    else if (item instanceof RequestAPI) {
                        //Если нет данных, то откидываем платформу
                        if (!item.auth) this.platforms.authorization.push(item.name);

                        //Поддерживает ли платформа получение аудио
                        if (!item.audio) this.platforms.audio.push(item.name);

                        this.platforms.supported.push(item);
                    }

                    //Здесь выводим сообщение об ошибке
                    else Logger.log("ERROR", `[FS/${file}]: ${item.message}`);
                });
                Logger.log("LOG", `[Shard ${client.ID}] has initialize ${path}`);
            } catch (err) {
                Logger.log("ERROR", err);
            }
        }
    };

    /**
     * @description Запускаем db
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    public initHandler = async (client: Atlas) => {
        const loaders = [await this.getFilters, await this.initFs(client), await this.registerCommands(client)];

        for (let n = 0; n < loaders.length; n++) {
            const loader = loaders[n];

            if (loader instanceof Error) throw loader;
        }
    };
}



import {readdirSync} from "node:fs";
class loadHandlerDir<T> {
    private readonly path: string;
    private readonly callback: (data: T | {error: true, message: string}, file: string) => void;

    public constructor(path: string, callback: (data: T | {error: true, message: string}, file: string) => void) {
        this.path = `src/${path}`; this.callback = callback;

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };

    /**
     * @description Загружаем файлы из директории
     * @param dir {string} Директория из которой будем читать
     * @return void
     * @private
     */
    private readonly readDir = (dir?: string) => {
        const path = dir ? `${this.path}/${dir}` : this.path;

        readdirSync(path).forEach((file) => {
            if (!file.endsWith(".js")) return;

            try {
                const importFile = require(`../../${path}/${file}`);
                const keysFile = Object.keys(importFile);

                if (keysFile.length <= 0) {
                    this.callback({ error: true, message: "TypeError: Not found imports data!"}, `${path}/${file}`);
                    return;
                }

                this.callback(new importFile[keysFile[0]], `${path}/${file}`);
            } catch (e) {
                this.callback({ error: true, message: e}, `${path}/${file}`);
            }
        });
    };
}