import {Database_Commands} from "@handler/Database/Global/Commands";
import {Database_Audio} from "@handler/Database/Global/Audio";
import {Database_APIs} from "@handler/Database/Global/APIs";
import {API, Handler} from "@handler";
import {Client} from "@lib/discord";
import {env, Logger} from "@env";

/**
 * @author SNIPPIK
 * @description База с загрузчиками
 */
const loaders: {name: string, callback: (client: Client, item: any) => void}[] = [
    {
        name: "handlers/APIs",
        callback: (_, item: API.request) => {
            if (!item.auth) db.api.platforms.authorization.push(item.name);
            if (!item.audio) db.api.platforms.audio.push(item.name);

            db.api.platforms.supported.push(item);
        }
    },
    {
        name: "handlers/Commands",
        callback: (_, item: Handler.Command) => {
            if (item.data.options) {
                for (const option of item.data.options) {
                    if ("options" in option)
                        db.commands.subCommands += option.options.length;
                }
                db.commands.subCommands += item.data.options.length;
            }
            db.commands.push(item);
        }
    },
    {
        name: "handlers/Events",
        callback: (client, item: Handler.Event<any>) => {
            if (item.type === "client") client.on(item.name as any, (...args) => item.execute(client, ...args));
            else db.audio.queue.events.on(item.name as any, (...args) => item.execute(...args));
        }
    },
    {
        name: "handlers/Plugins",
        callback: (client, item: Handler.Plugin) => {
            try {
                item.start({ client });
            } catch (err) {
                throw new Error(`[Plugin]: ${err}`);
            }
        }
    }
];

/**
 * @author SNIPPIK
 * @class Database
 * @description База данных бота
 * @public
 */
export const db = new class Database {
    private readonly loaded = {
        commands:   new Database_Commands(),
        audio:      new Database_Audio(),
        apis:       new Database_APIs()
    };

    /**
     * @description База для управления музыкой
     * @public
     */
    public get audio() { return this.loaded.audio };

    /**
     * @description База для управления APIs
     * @public
     */
    public get api() { return this.loaded.apis };

    /**
     * @description Выдаем класс с командами
     * @public
     */
    public get commands() { return this.loaded.commands; };

    /**
     * @description Путь до ветки github (Официального репозитория)
     * @public
     */
    public readonly git = `${env.get("git")}/${env.get("branch")}/`;

    /**
     * @description ID пользователей которые являются разработчиками
     * @public
     */
    public readonly owners = env.get("owner.list").match(/,/) ? env.get("owner.list").split(",") : [env.get("owner.list")] as string[];

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public readonly emojis = {
        button: {
            resume: env.get("button.resume"),
            pause: env.get("button.pause"),
            loop: env.get("button.loop"),
            loop_one: env.get("button.loop_one"),
            pref: env.get("button.pref"),
            next: env.get("button.next"),
            shuffle: env.get("button.shuffle")
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
            bottom: env.get("progress.bottom"),
            bottom_vk: env.get("progress.bottom.vk"),
            bottom_yandex: env.get("progress.bottom.yandex"),
            bottom_youtube: env.get("progress.bottom.youtube"),
            bottom_spotify: env.get("progress.bottom.spotify"),
        },
        noImage: this.git + env.get("image.not"),
        diskImage: this.git + env.get("image.currentPlay")
    };

    /**
     * @description Запускаем index
     * @param client {Client} Класс клиента
     * @public
     */
    public set initialize(client: Client) {
        Logger.log("LOG", `[Shard ${client.ID}] is initialized database`);

        (async () => {
            //Проверяем статус получения фильтров
            if (this.audio.filters.length > 0) Logger.log("LOG", `[Shard ${client.ID}] is initialized filters`);
            else Logger.log("ERROR", `[Shard ${client.ID}] is initialized filters`);

            //Постепенно загружаем директории с данными
            for (const handler of loaders) {
                try {
                    // @ts-ignore
                    new Handler({ path: handler.name, callback: (...args) => handler.callback(client, ...args) });
                    Logger.log("LOG", `[Shard ${client.ID}] have been uploaded, ${handler.name}`);
                } catch (err) {
                    Logger.log("ERROR", err);
                }
            }

            //Отправляем данные о командах на сервера discord
            if (client.ID === 0) await this.commands.register(client);
        })();
    };
}