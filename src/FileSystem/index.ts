import {existsSync, mkdirSync, readdirSync} from "node:fs";
import {Command} from "@Structures/Handle/Command";
import {Module} from "@Structures/Handle/Module";
import {Event} from "@Structures/Handle/Event";
import {WatKLOK} from "@Client/Client";

type TypeFileLoad = Command | Event<any, any> | Module;
type FileCallback = (pull: TypeFileLoad, {}: { dir: string, file: string, reason: string }) => void;

let FileBase = {
    Commands: [] as string[],
    Events: [] as string[]
};

export namespace FileSystem {
    export function createDirs(dir: string) {
        let dirs = dir.split("/");

        if (!dir.endsWith("/")) dirs.splice(dirs.length - 1);

        let currentDir = "";

        for (let i in dirs) {
            currentDir += `${dirs[i]}/`;
            if (!existsSync(currentDir)) mkdirSync(currentDir);
        }
    }
}

//Добавляем лог в Array базу
function log(type: "Commands" | "Events", dir: string, file: string, reason?: string) {
    const Status = `Status: [${reason ? "🟥" : "🟩"}]`;
    const File = `File: [src/Handler/${type}/${dir}/${file}]`;
    let EndStr = `${Status} | ${File}`;

    if (reason) EndStr += ` | Reason: [${reason}]`; //Если есть ошибка добавляем ее

    return FileBase[type].push(EndStr);
}
//Загружаем файлы
export function LoadFiles(client: WatKLOK) {
    const loadCallbacks: FileCallback[] = [ //Каким способом их обработать
        (pull: Command, {file, reason, dir}) => {
            if (reason) return log("Commands", dir, file, reason);
            else if (!pull.name) return log("Commands", dir, file, "Parameter name has undefined");

            client.commands.set(pull.name, pull);
            log("Commands", dir, file);
        },
        (pull: Event<any, any>, {file, reason, dir}) => {
            if (reason) return log("Events", dir, file, reason);
            else if (!pull.name) return log("Events", dir, file, "Parameter name has undefined");

            client.on(pull.name, (ev: any, ev2: any) => pull.run(ev, ev2, client));
            log("Events", dir, file);
        }
    ];

    //Загружаем путь, а затем действие
    ["Handler/Commands", "Handler/Events"].forEach((path, index) => {
        new FileLoader({path, callback: loadCallbacks[index]});

        setImmediate(() => {
            if (client.ShardID === undefined) Object.entries(FileBase).forEach(([key, value]) => console.log(`| FileSystem... Loaded ${key} | ${value.length}\n${value.join("\n")}\n`));
            //После вывода в консоль удаляем
            Object.entries(FileBase).forEach(([key,]) => delete FileBase[key as "Commands" | "Events"]);
        });
    });
}

class FileLoader {
    private readonly path: string;
    private readonly callback: FileCallback;

    public constructor(options: { path: string, callback: FileCallback }) {
        this.path = options.path;
        this.callback = options.callback;

        this.readDir();
    };
    private readonly readDir = () => {
        //Смотрим что находится в папке
        readdirSync(`./src/${this.path}`).forEach(async (dir: string) => {
            if (dir.endsWith(".js") || dir.endsWith(".ts")) return;

            //Берем файлы мз папки
            const files = readdirSync(`./src/${this.path}/${dir}/`).filter((file: string) => (file.endsWith(".js") || file.endsWith(".ts")));

            for (let file of files) {
                let reason: string = null;
                const pull = await this.findExport(`../${this.path}/${dir}/${file}`);

                //Добавляем ошибки если они как таковые есть
                if (!pull) reason = "Not found exports";
                else if (!pull.isEnable) reason = "Parameter isEnable has false";
                else if (!pull.run) reason = "Function run has not found";

                //Если при загрузке произошла ошибка
                if (pull instanceof Error) reason = pull.message;
                if ("type" in pull) pull.type = dir; //Если есть type в pull

                this.callback(pull, {dir, file, reason}); //Отправляем данные в callback
            }
        });
    };
    //Загружаем export
    private readonly findExport = async (path: string): Promise<null | any> => {
        const importFile = (await import(path));
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
    };
}