import {DotenvPopulateInput, config} from "dotenv";

/**
 * @author SNIPPIK
 * @description Взаимодействуем с env
 */
export const env = new class {
    private readonly dotenv = config();
    /**
     * @description Получаем значение
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly get = (name: keyof DotenvPopulateInput): any => {
        const env = this.dotenv.parsed[name];

        if (!env) throw new Error(`[ENV]: Not found ${name} in .env`);

        return env === "true" ? true : env === "false" ? false : env;
    };

    /**
     * @description Проверяем есть ли данные
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly check = (name: string) => {
        const env = this.dotenv.parsed[name];

        return !(!env || env === "undefined");
    };
}