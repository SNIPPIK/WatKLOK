import fs, {existsSync, mkdirSync, readFileSync, writeFileSync} from "fs";
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
        const envFile = fs.readFileSync(".env", "utf8").split(os.EOL);

        //Ищем имя
        const target = envFile.indexOf(envFile.find((line) => line.match(new RegExp(key))));

        //Обновляем данные
        envFile.splice(target, 1, `${key}="${value}"`);

        try {
            //Сохраняем файл
            fs.writeFileSync(".env", envFile.join(os.EOL));

            //Обновляем env
            setImmediate(() => require("dotenv").config());
        } catch (e) {
            Logger.warn(`[ENV]: Fail save ${key} to .env`);
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