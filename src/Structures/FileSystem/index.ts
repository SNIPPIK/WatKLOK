import { Command, Event } from "@Structures/Handlers";
import { existsSync, readdirSync } from "fs";
import { WatKLOK } from "@Client";


export namespace FileSystem {
    /**
     * @description Загружаем файлы в FileBase<type>
     * @param client {WatKLOK} Бот
     */
    export function initFileSystem(client: WatKLOK): void {
        const paths: (string | FileCallback)[] = [

            //Команды бота
            "Commands",
            (pull: Command, { file, reason, dir }) => {
                if (reason) return log("Commands", dir, file, reason);
                else if (!pull.name) return log("Commands", dir, file, "Parameter name has undefined");

                client.commands.set(pull.name, pull);
                log("Commands", dir, file);
            },

            //Ивенты бота
            "Events",
            (pull: Event<any, any>, { file, reason, dir }) => {
                if (reason) return log("Events", dir, file, reason);
                else if (!pull.name) return log("Events", dir, file, "Parameter name has undefined");

                client.on(pull.name, (ev: any, ev2: any) => pull.run(ev, ev2, client));
                log("Events", dir, file);
            }
        ];

        //Загружаем данные
        for (let path of paths) {
            if (typeof path === "string") new FileLoader({ path, callback: paths[paths.indexOf(path) + 1] as FileCallback });

            if (paths.indexOf(path) + 1 === paths.length) {
                setImmediate((): void => {
                    //Выводим в консоль статус загрузки
                    if (client.shardID === undefined) Object.entries(TempLogsData).forEach(([key, value]) => {
                        console.log(`| FileSystem... Loaded ${key} | ${value.length}\n${value.join("\n")}\n`);
                    });
                });

                setTimeout(() => TempLogsData = null, 7e3);
            }
        }
    }
}

//====================== ====================== ====================== ======================
/**
 -  Loading files
 - Commands, Events
 */
let TempLogsData: { Commands: string[], Events: string[] } = {
    Commands: [],
    Events: []
};

/**
 @description Как загружать команды или ивенты
 */
type FileCallback = (pull: Command | Event<any, any>, {}: {dir: string, file: string, reason: string}) => void;

/**
 * @description Загрузчик (загрузит необходимые файлы из главной директории)
 */
class FileLoader {
    //Путь к месту загрузки
    private readonly path: string;

    //Каким образом загружаем команды или ивенты
    private readonly callback: FileCallback;

    public constructor(options: { path: string, callback: FileCallback }) {
        this.path = options.path;
        this.callback = options.callback;

        this.readDir();
    };
    private readonly readDir = (): void => {
        //Если указанного пути нет
        if (!existsSync(`./src/${this.path}`)) throw Error(`[FileSystem]: Not found path src/${this.path}!`)

        //Смотрим что находится в папке
        readdirSync(`./src/${this.path}`).forEach(async (dir: string) => {
            if (dir.endsWith(".js") || dir.endsWith(".ts")) return;

            let reason: string = null;

            //Берем файлы мз папки
            const files = readdirSync(`./src/${this.path}/${dir}/`).filter((file: string) => (file.endsWith(".js") || file.endsWith(".ts")));

            for (let file of files) {
                const pull = await this.findExport(`../../${this.path}/${dir}/${file}`);

                //После загрузки удаляем
                delete require.cache[`../../${this.path}/${dir}/${file}`];

                //Добавляем ошибки если они как таковые есть
                if (!pull) reason = "Not found exports";
                else if (!pull.isEnable) reason = "Parameter isEnable has false";
                else if (!pull.run) reason = "Function run has not found";

                //Если при загрузке произошла ошибка
                if (pull instanceof Error) reason = pull.message;
                if ("type" in pull) pull.type = dir; //Если есть type в pull

                //Удаляем данные которые больше не нужны
                delete pull.isEnable;

                this.callback(pull, { dir, file, reason }); //Отправляем данные в callback
            }
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Достаем из файла class
     * @param path {string} Путь до файла
     */
    private readonly findExport = async (path: string): Promise<null | any> => {
        const importFile = (await import(path));
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
    };
}

/**
 * @description Создаем и добавляем лог
 * @param type {"Commands" | "Events"} Куда надо добавить
 * @param dir {string} Путь до файла
 * @param file {string} Файл
 * @param reason {string} Если загрузка прервана из-за ошибки
 */
function log(type: "Commands" | "Events", dir: string, file: string, reason?: string): number {
    const Status = `Status: [${reason ? "🟥" : "🟩"}]`;
    const File = `File: [src/${type}/${dir}/${file}]`;
    let EndStr = `${Status} | ${File}`;

    if (reason) EndStr += ` | Reason: [${reason}]`; //Если есть ошибка добавляем ее

    return TempLogsData[type].push(EndStr);
}
//====================== ====================== ====================== ======================
require("dotenv").config();
/**
 * @description Env
 */
export namespace env {
    export function get(name: string): string { return process.env[name]; }
}