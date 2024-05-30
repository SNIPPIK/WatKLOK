import {readFileSync, writeFileSync} from "node:fs";
import {config, DotenvPopulateInput} from "dotenv";
import {threadId} from "node:worker_threads";
import process from "node:process";
import os from "node:os";

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
        const env = this.dotenv.parsed[name];

        return !(!env || env === "undefined");
    };
}

/**
 * @author SNIPPIK
 * @description Простенький logger
 * @public
 */
export const Logger = new class {
    private readonly size = parseInt(env.get("console.size")) ?? 130;
    private readonly debug = process["argv"].includes("--dbg");
    private readonly status = {
        "DEBUG": "\x1b[34mi\x1b[0m",
        "WARN": "\x1b[33mi\x1b[0m",
        "ERROR": "\x1b[31mi\x1b[0m",
        "LOG": "\x1b[32mi\x1b[0m"
    };
    private readonly colors = {
        "DEBUG": "\x1b[90m",
        "WARN": "\x1b[33m",
        "ERROR": "\x1b[31m",
        "LOG": ""
    };

    /**
     * @description Отправляем лог с временем
     * @param status {string} Статус лога
     * @param text {string} Текст лога
     */
    public log = (status: "DEBUG" | "WARN" | "ERROR" | "LOG", text: string): void => {
        if (status === "DEBUG" && !this.debug || !(typeof text?.replace === 'function')) return;

        text = text.replace(/\[/g, "\x1b[100m \x1b[30m").replace(/]/g, " \x1b[0m");

        const extStatus = this.status[status];
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;
        const spaces = this.size - (extStatus.length + text.length) - (time.length);
        const extText = spaces < 0 ? `${text}\x1b[0m` : `${text}\x1b[0m${" ".repeat(spaces) + time}`;

        console.log(`\x1b[35m${threadId} |\x1b[0m ${extStatus} `  + `${this.colors[status]}${extText}`);
    };
}

/**
 * @description Все prototype объектов
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    //Array
    {
        type: Array.prototype, name: "ArraySort",
        value: function (number = 5, callback: (value: number, index: number) => void, joined = "\"\\n\\n\"") {
            const pages: string[] = [];
            let page: string = '';

            for (let i = 0; i < this.length; i += number) {
                page = this.slice(i, i + number).map((value: number, index: number) => callback(value, index)).join(joined);
                if (page !== '') pages.push(page);
            }

            return pages;
        }
    },
    {
        type: Array.prototype, name: "time",
        value: function () {
            return this.reduce((total: number, item: {
                duration: { seconds: number }
            }) => total + (item.duration.seconds || 0), 0).duration();
        }
    },
    {
        type: Array.prototype,
        name: "swap",
        value: function(position: number) {
            [this[0], this[position]] = [this[position], this[0]];

            return this;
        }
    },

    //String
    {
        type: String.prototype, name: "duration",
        value: function () {
            const time = this?.split(":").map(Number) ?? [parseInt(this)];
            return time.length === 1 ? time[0] : time.reduce((acc: number, val: number) => acc * 60 + val);
        }
    },

    //Number
    {
        type: Number.prototype, name: "duration",
        value: function () {
            const days = Math.floor(this / (60 * 60 * 24)).toSplit() as number;
            const hours = Math.floor((this % (60 * 60 * 24)) / (60 * 60)).toSplit() as number;
            const minutes = Math.floor((this % (60 * 60)) / 60).toSplit() as number;
            const seconds = Math.floor(this % 60).toSplit() as number;

            return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
        }
    },
    {
        type: Number.prototype, name: "toSplit",
        value: function () {
            const fixed = parseInt(this as string);
            return (fixed < 10) ? ("0" + fixed) : fixed;
        }
    },
    {
        type: Number.prototype, name: "random",
        value: function (min = 0) {
            return Math.floor(Math.random() * (this - min) + min);
        }
    },
    {
        type: Number.prototype,
        name: "bytes",
        value: function() {
            const sizes = ["Bytes", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(this) / Math.log(1024));
            return `${(this / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
        }
    }
];
for (const property of prototypes) Object.defineProperty(property.type, property.name, {value: property.value});

/**
 * @description Декларируем их для typescript
 */
declare global {
    interface Array<T> {
        /**
         * @prototype Array
         * @description Превращаем Array в Array<Array>
         * @param number {number} Сколько блоков будет в Array
         * @param callback {Function} Как фильтровать
         * @param joined {string} Что добавить в конце
         */
        ArraySort(number: number, callback: (value: T, index?: number) => string, joined?: string): string[];

        /**
         * @prototype Array
         * @description Совмещаем время всех треков из очереди
         * @return string
         */
        time(): string;

        /**
         * @description Смена позиции в Array
         * @param position {number} Номер позиции
         */
        swap(position: number): this;
    }
    interface String {
        /**
         * @prototype String
         * @description Превращаем 00:00 в число
         * @return number
         */
        duration(): number;
    }
    interface Number {
        /**
         * @prototype Number
         * @description превращаем число в байты
         * @return string
         */
        bytes(): string;

        /**
         * @prototype Number
         * @description Превращаем число в 00:00
         * @return string
         */
        duration(): string;

        /**
         * @prototype Number
         * @description Добавляем 0 к числу. Пример: 01:10
         * @return string | number
         */
        toSplit(): string | number;

        /**
         * @prototype Number
         * @description Получаем случайное число
         * @param min {number} Мин число
         */
        random(min?: number): number;
    }
}