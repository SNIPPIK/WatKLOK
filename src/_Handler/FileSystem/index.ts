import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { Command } from "@Handler/FileSystem/Handle/Command";
import { Module } from "@Handler/FileSystem/Handle/Module";
import { Event } from "@Handler/FileSystem/Handle/Event";
import { WatKLOK } from "@Client/Client";

type TypeFileLoad = Command | Event<any, any> | Module;
type FileCallback = (pull: TypeFileLoad, { }: { dir: string, file: string, reason: string }) => void;

let tempLogs: { Commands: string[], Events: string[] } = { Commands: [], Events: [] };

export namespace FileSystem {
    /**
     * @description Создаем полноценный путь
     * @param dir {string} dir/dir/dir
     */
    export function createDirs(dir: string): void {
        let dirs = dir.split("/"), currentDir = "";

        if (!dir.endsWith("/")) dirs.splice(dirs.length - 1);

        for (let i in dirs) { currentDir += `${dirs[i]}/`; if (!existsSync(currentDir)) mkdirSync(currentDir); }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Загружаем файлы в FileBase<type>
     * @param client {WatKLOK} Бот
     */
    export function initFileSystem(client: WatKLOK): void {
        const paths: (string | FileCallback)[] = [

            //Команды бота
            "_Handler/Commands",
            (pull: Command, { file, reason, dir }) => {
                if (reason) return log("Commands", dir, file, reason);
                else if (!pull.name) return log("Commands", dir, file, "Parameter name has undefined");

                client.commands.set(pull.name, pull);
                log("Commands", dir, file);
            },

            //Ивенты бота
            "_Handler/Events",
            (pull: Event<any, any>, { file, reason, dir }) => {
                if (reason) return log("Events", dir, file, reason);
                else if (!pull.name) return log("Events", dir, file, "Parameter name has undefined");

                client.on(pull.name, (ev: any, ev2: any) => pull.run(ev, ev2, client));
                log("Events", dir, file);
            }
        ];

        //Загружаем данные
        for (let path of paths) {
            if (typeof path === "string") {
                new FileLoader({ path, callback: paths[paths.indexOf(path) + 1] as FileCallback });

                //Выводим в консоль статус загрузки
                Object.entries(tempLogs).forEach(([key, value]) => {
                    if (client.ShardID === undefined) console.log(`| FileSystem... Loaded ${key} | ${value.length}\n${value.join("\n")}\n`);
                });
            }

            if (paths.indexOf(path) + 1 === paths.length) setTimeout(() => tempLogs = null, 7e3);
        }
    }
}
//====================== ====================== ====================== ======================
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
        //Смотрим что находится в папке
        readdirSync(`./src/${this.path}`).forEach(async (dir: string) => {
            if (dir.endsWith(".js") || dir.endsWith(".ts")) return;

            //Берем файлы мз папки
            const files = readdirSync(`./src/${this.path}/${dir}/`).filter((file: string) => (file.endsWith(".js") || file.endsWith(".ts")));

            for (let file of files) {
                let reason: string = null;
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
//====================== ====================== ====================== ======================
/**
 * @description Создаем и добавляем лог
 * @param type {"Commands" | "Events"} Куда надо добавить
 * @param dir {string} Путь до файла
 * @param file {string} Файл
 * @param reason {string} Если загрузка прервана из-за ошибки
 */
function log(type: "Commands" | "Events", dir: string, file: string, reason?: string): number {
    const Status = `Status: [${reason ? "🟥" : "🟩"}]`;
    const File = `File: [src/_Handler/${type}/${dir}/${file}]`;
    let EndStr = `${Status} | ${File}`;

    if (reason) EndStr += ` | Reason: [${reason}]`; //Если есть ошибка добавляем ее

    return tempLogs[type].push(EndStr);
}