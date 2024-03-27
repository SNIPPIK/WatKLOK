import {DotenvPopulateInput, config} from "dotenv";
import {threadId} from "node:worker_threads";
import process from "node:process";

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

/**
 * @author SNIPPIK
 * @description Простенький logger
 * @public
 */
export const Logger = new class {
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
        const spaces = 130 - (extStatus.length + text.length) - (time.length);
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
        value: function (number = 5, callback, joined = "\"\\n\\n\"") {
            const pages: string[] = [];
            const lists: any[] = Array(Math.ceil(this.length / number)).fill(this[0]).map((_, i) => this.slice(i * number, i * number + number));

            for (const list of lists) {
                const text = list.map((value, index) => callback(value, index)).join(joined);

                if (text !== undefined) pages.push(text);
            }

            return pages;
        }
    },
    {
        type: Array.prototype, name: "time",
        value: function () {
            let time: number = 0;

            //Если есть треки в списке
            if (this.length > 0) {
                for (let item of this) time += item.duration.seconds;
            }

            return time.duration();
        }
    },
    {
        type: Array.prototype,
        name: "swap",
        value: function(position: number) {
            const first = this[0];
            this[0] = this[position];
            this[position] = first;

            return this;
        }
    },

    //String
    {
        type: String.prototype, name: "duration",
        value: function () {
            const time = this?.split(":").map((value: string) => parseInt(value)) ?? [parseInt(this)];

            switch (time.length) {
                case 4: return (time[0] * ((60 * 60) * 24)) + (time[1] * ((60 * 60) * 24)) + (time[2] * 60) + time[3];
                case 3: return (time[0] * ((60 * 60) * 24)) + (time[1] * 60) + time[2];
                case 2: return (time[0] * 60) + time[1];
                default: return time[0];
            }
        }
    },

    //Number
    {
        type: Number.prototype, name: "duration",
        value: function () {
            const days =    (this / ((60 * 60) * 24) % 24).toSplit() as number;
            const hours =   (this / (60 * 60) % 24).toSplit()        as number;
            const minutes = ((this / 60) % 60).toSplit()             as number;
            const seconds = (this % 60).toSplit()                    as number;

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
            const fixed = (Math.random() * (this - min) + min).toFixed(0);
            return parseInt(fixed);
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
        random(min?: number): string | number;
    }
}