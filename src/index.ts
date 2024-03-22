import {Client, Logger, ShardManager} from "@lib/discord";
import process from "node:process";
import {Colors} from "discord.js";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @description Загружаем данные в зависимости от выбора
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new Client();

    /**
     * @description Подключаемся к api.discord
     */
    client.login(env.get("token.discord")).then(() => {
        //Запускаем загрузку модулей после инициализации бота
        client.once("ready", async () => {
            Logger.log("LOG", `[Shard ${client.ID}] is connected to websocket`);
            await db.initHandler(client);
        });
    });

    /**
     * @description Удаляем копию клиента если процесс был закрыт
     */
    for (const event of ["exit"]) process.on(event, () => {
        Logger.log("DEBUG", "[Process]: is killed!");
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0);
    });

    /**
     * @description Ловим попытки сломать процесс
     */
    process.on("uncaughtException", (err: Error) => {
        if (err?.message?.match(/APIs/)) Logger.log("WARN", `[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
        else if (err.name?.match(/acknowledged./)) Logger.log("WARN", `[CODE: <50490>]: [${err.name}/${err.message}]\nЗапущено несколько ботов!\nЗакройте их через диспетчер!`);

        //Если не прописана ошибка
        else Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

        client.sendWebhook = {
            username: client.user.username,
            avatarURL: client.user.avatarURL(),
            embeds: [{
                title: "uncaughtException",
                description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                fields: [{
                    name: "Stack:",
                    value: `\`\`\`${err.stack}\`\`\``
                }],
                color: Colors.DarkRed,
            }],
        }
    });
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
];

/**
 * @description Загружаем prototype объектов
 */
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
        time(): string
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