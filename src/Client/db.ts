import {Collection as AudioCollection} from "@Client/Audio/Queue/Collection";
import {Filter} from "@Client/Audio/Player/AudioResource";
import {Collection, Routes} from "discord.js";
import {Command, Event, API, RequestAPI} from "@handler";
import {httpsClient} from "@Client/Request";
import {Atlas, Logger} from "@Client";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class QuickDB
 * @description База данных бота
 */
export const db = new class QuickDB {
    /**
     * @author SNIPPIK
     * @description Класс в котором хранятся команды
     * @private
     */
    private readonly _commands = new class extends Collection<string, Command> {
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
    };
    public get commands() { return this._commands; };

    /**
     * @author SNIPPIK
     * @description Все данные относящиеся к музыке
     * @private
     */
    private readonly _music = new class {
        private readonly _queue = new AudioCollection();
        private readonly _filters: Filter[] = [];
        private readonly _platform = {
            supported: [] as RequestAPI[],
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
                const raw = await new httpsClient(env.get("filters.url"), {useragent: true}).toJson;

                if (raw instanceof Error) return reject(raw);
                this._filters.push(...raw);

                return resolve(true);
            });
        };
    }
    public get music() { return this._music; };

    /**
     * @author SNIPPIK
     * @description Все смайлики
     * @private
     */
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
    public get emojis() { return this._emojis; };


    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    public registerApplicationCommands = (client: Atlas): Promise<true> => {
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
    public initHandler = async (client: Atlas) => {
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
                    else if ("audio" in item) {
                        //Если нет данных, то откидываем платформу
                        if (!item.auth) this.music.platforms.authorization.push(item.name);

                        //Поддерживает ли платформа получение аудио
                        if (!item.audio) this.music.platforms.audio.push(item.name);

                        this.music.platforms.supported.push(item);
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