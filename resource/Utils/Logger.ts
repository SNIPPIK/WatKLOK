import { DurationUtils } from "./Durations";

class Logger_ {
    private get time() {
        const date = new Date();
        const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(DurationUtils.toFixed0).join(":");
        let ms = `${date.getMilliseconds()}`;

        if (ms.length === 1) ms = `00${ms}`;
        else if (ms.length === 2) ms = `0${ms}`;

        return `[${time}.${ms}]`;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly log = (text: string) => {
        process.stdout.write(`${this.time} ➜ ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}\n`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем и красным текстом
     * @param text {string} Текст лога
     */
    public readonly error = (text: string): void => {
        process.stdout.write(`${this.time} ➜ [\x1b[31mError\x1b[0m]: \x1b[31m${text}\x1b[0m\n`);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly debug = (text: string): void => {
        process.stdout.write(`${this.time} ➜ [\x1b[33mDebug\x1b[0m]: ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}\n`);
    }
}

export const Logger = new Logger_();