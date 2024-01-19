import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import process from "process";
import os from "node:os";
require("dotenv").config();

/**
 * @author SNIPPIK
 * @class env
 * @description Взаимодействуем с env
 */
export const env = new class {
    /**
     * @description Получаем значение
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly get = (name: string): any => {
        const env = process.env[name];

        if (!env) throw new Error(`[ENV]: Not found ${name} in .env`);

        return env === "true" ? true : env === "false" ? false : env;
    }

    /**
     * @description Обновляем данные в env (не работает на некоторых хостингах)
     * @param key {string} Имя
     * @param value {string} значение
     * @readonly
     * @public
     */
    public readonly set = (key: string, value: string): void => {
        //Открываем файл env в array
        const envFile = readFileSync(".env", "utf8").split(os.EOL);

        //Ищем имя
        const target = envFile.indexOf(envFile.find((line) => line.match(new RegExp(key))));

        //Обновляем данные
        envFile.splice(target, 1, `${key}="${value}"`);

        try {
            //Сохраняем файл
            writeFileSync(".env", envFile.join(os.EOL));

            //Обновляем env
            setImmediate(() => require("dotenv").config());
        } catch (e) {
            //Logger.warn(`[ENV]: Fail save ${key} to .env`);
        }
    };

    /**
     * @description Проверяем есть ли данные
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly check = (name: string) => {
        const env = process.env[name];

        return !(!env || env === "undefined");
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