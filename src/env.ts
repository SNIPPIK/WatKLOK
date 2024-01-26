import {readFileSync, writeFileSync} from "node:fs";
import {Logger} from "@Client";
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
            Logger.log("WARN", `[ENV]: Fail save ${key} to .env`);
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