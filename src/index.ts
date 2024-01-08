import {readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync} from "node:fs";
import {Atlas, Command, ShardManager, Event, Commands} from "@Client";
import {db_Music} from "@Client/Audio";
import {Routes} from "discord.js";
import {API} from "@handler/APIs";
import process from "process";
import {env} from "@env";

const debug = env.get("debug");
/**
 * @author SNIPPIK
 * @class Logger
 * @description Простенький logger
 */
export const Logger = new class {
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly log = (text: string): void => {
        if (text.match(/[\[\]]/)) {
            const status = text.split("[")[1].split("]")[0].replace(/[\[\]]/, "");
            const editText = text.split("[")[0] + text.split("]").at(-1);

            return this.sendLog(`\x1b[32mi\x1b[0m`, `\x1b[46m \x1b[37m${status} \x1b[0m` + editText, 17);
        }
        return this.sendLog(`\x1b[32mi\x1b[0m`, text, 18);
    };

    /**
     * @description Отправляем лог с временем и красным текстом
     * @param text {string} Текст лога
     */
    public readonly error = (text: string) => this.sendLog(`\x1b[41m \x1b[30mERROR \x1b[0m`, `\x1b[31m ${text}\x1b[0m`, 17);

    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly debug = (text: string) => {
        if (debug) this.sendLog(`\x1b[34mi\x1b[0m`, `\x1b[90m ${text}\x1b[0m`, 12);
    };

    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly warn = (text: string) => this.sendLog(`\x1b[33mi\x1b[0m`, `\x1b[33m ${text}\x1b[0m`, 12);

    /**
     * @description Создаем примерный визуал
     * @param status {string} Статус - DEBUG, ERROR, WARN
     * @param text {string} Текст лога
     * @param supNum {number} Сколько добавить для правильного отображения времени
     */
    protected readonly sendLog = (status: string, text: string, supNum: number = 0) => {
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;
        const spaces = 130 - (status.length + text.length) - (time.length - supNum);

        if (spaces < 0) console.log(`\x1b[35m|\x1b[0m ${status} ` + text);
        else console.log(`\x1b[35m|\x1b[0m ${status} `  + text + " ".repeat(spaces) + time);
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
    private readonly _music = new db_Music();


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

            Logger.debug(`[Shard ${client.ID}]: [SlashCommands]: [Upload]: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            return resolve(true);
        });
    };

    /**
     * @description Загружаем Imports
     * @param client {Atlas} Класс клиента
     * @return Promise<true>
     * @public
     */
    public initHandler = (client: Atlas): Promise<true> => {
        return new Promise<true>((resolve) => {
            const dirs = ["Handlers/APIs", "Handlers/Commands", "Handlers/Events"];

            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];

                try {
                    new initDataDir<API.load | Command | Event<unknown>>(dir, (data) => {
                        if (data instanceof Command) this._commands.set(data.name, data);
                        else if (data instanceof Event) {
                            if (data.type === "atlas") client.on(data.name as any, (...args: any[]) => data.execute(client, ...args));
                            else if (data.type === "process") process.on(data.name as any, data.execute);
                        } else {
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


/**
 * @author SNIPPIK
 * @description Загрузчик файлов
 * @class initDataDir
 */
export class initDataDir<T = unknown> {
    private readonly path: string;
    private readonly callback: (data: T, file: string) => void;
    private _cacheFile: string = null;
    public constructor(path: string, callback: (data: T, file: string) => void) {
        this.path = `src/${path}`; this.callback = callback;

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };

    /**
     * @description Загружаем первый экспорт из файла
     * @return T
     * @private
     */
    private get loadFile(): T {
        const importFile = require(`../${this._cacheFile}`);
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
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
                this._cacheFile = `${path}/${file}`;
                const hasLoad = this.loadFile;

                Logger.debug(`Fs: [Load]: ${this._cacheFile}`);

                this.callback(hasLoad, this._cacheFile);
            } catch (e) { throw Error(e) }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Управление файлами
 * @namespace
 */
export namespace FileSystem {
    /**
     * @description Получаем файл данные из файла
     * @param dir {string} Путь файла
     */
    export function getFile(dir: string) {
        if (!existsSync(dir)) return null;

        return readFileSync(dir, {encoding: "utf-8"});
    }


    /**
     * @description Сохраняем данные в файл
     * @param dir {string} Путь файла
     * @param data {any} Данные для записи
     */
    export function saveToFile(dir: string, data: any): void {
        if (!existsSync(dir)) {
            let fixDir = dir.split("/");
            fixDir.splice(fixDir.length - 1, 1);

            mkdirSync(`${fixDir.join("/")}/`, {recursive: true});
        }

        setTimeout(() => {
            const file: object = JSON.parse(FileSystem.getFile(dir));
            writeFileSync(dir, JSON.stringify(data ? data : file, null, `\t`));
        }, 2e3);
    }
}






/**
 * @description Загружаем данные в зависимости от выбора
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new Atlas();

    client.login(env.get("token.discord")).then(() => {
        client.once("ready", async () => {
            Logger.log(`[Shard ${client.ID}] has connected for websocket`);

            for (const status of [await db.music.gettingFilters, await db.initHandler(client), await db.registerApplicationCommands(client)]) {
                if (status instanceof Error) throw status;
            }
        });
    });

    for (const event of ["SIGTERM", "SIGINT", "exit"]) {
        process.on(event, () => {
            client.destroy().catch(Logger.error);
            process.exit(0);
        });
    }
}