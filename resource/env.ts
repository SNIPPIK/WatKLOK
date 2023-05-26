import fs from "fs";
import os from "node:os";

require("dotenv").config();
export namespace env {
    /**
     * @description Получаем значение
     * @param name {string} Имя
     */
    export function get(name: string): any {
        const env = process.env[name];

        if (!env || env === "undefined") new Error(name);

        return env === "true" ? true : env === "false" ? false : env;
    }
    //====================== ====================== ====================== ======================
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