import process from "process";
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