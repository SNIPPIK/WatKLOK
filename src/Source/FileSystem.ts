import {Logger} from "@Utils/Logger";
import fs, {readdirSync} from "fs";
import os from "node:os";
import * as process from "process";

require("dotenv").config();
export namespace env {
    /**
     * @description Получаем значение
     * @param name {string} Имя
     */
    export function get(name: string): any {
        const env = process.env[name];

        if (!env || env === "undefined") throw new Error(`[Error]: [env]: Not found ${name}`);

        return env === "true" ? true : env === "false" ? false : env;
    }


    /**
     * @description Обновляем данные в env (не работает на некоторых хостингах)
     * @param key {string} Имя
     * @param value {string} значение
     */
    export function set(key: string, value: string): void {
        //Открываем файл env в array
        const envFile = fs.readFileSync("./.env", "utf8").split(os.EOL);

        //Ищем имя
        const target = envFile.indexOf(envFile.find((line) => line.match(new RegExp(key))));

        //Обновляем данные
        envFile.splice(target, 1, `${key}="${value}"`);

        try {
            //Сохраняем файл
            fs.writeFileSync("./.env", envFile.join(os.EOL));

            //Обновляем env
            setImmediate(() => require("dotenv").config());
        } catch (e) {}
    }
}


export class initDataDir<type> {
    private readonly path: string;
    private readonly callback: (file: string, data: type) => void;
    private readonly isFiles: boolean;
    private file: string;


    /**
     * @description Загружаем первый экспорт из файла
     */
    private get loadFile() {
        const importFile = require(`../../${this.file}`);
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
    };


    public constructor(path: string, callback: (file: string, data: type) => void, isFiles: boolean = false) {
        this.path = `src/${path}`; this.callback = callback; this.isFiles = isFiles
    };


    /**
     * @description Начинаем чтение
     */
    public readonly reading = () => {
        if (this.isFiles) return this.readDir();

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };


    /**
     * @description Загружаем файлы из директории
     * @param dir {string} Директория из которой будем читать
     */
    private readonly readDir = (dir?: string) => {
        const path = dir ? `${this.path}/${dir}/` : this.path;

        readdirSync(path).forEach((file) => {
            if (!file.endsWith(".js")) return;

            try {
                this.file = `${path}/${file}`;
                const hasLoad: type = this.loadFile;

                if (env.get("debug.fs")) Logger.debug(`Fs: [Load]: ${path.endsWith("/") ? `${path}${file}` : `${path}/${file}`}`);

                this.callback(this.file, hasLoad);
            } catch (e) { Logger.error(e); }
        });
    }
}