import { DurationUtils } from "../Durations";

export namespace Logger {
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    export function log(text: string): void {
        const Time = currentTime();

        process.stdout.write(`${Time} ➜ ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}\n`);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем и красным текстом
     * @param text {string} Текст лога
     */
    export function error(text: string): void {
        const Time = currentTime();

        process.stdout.write(`${Time} ➜ [\x1b[31mError\x1b[0m]: \x1b[31m${text}\x1b[0m\n`);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    export function debug(text: string): void {
        const Time = currentTime();

        process.stdout.write(`${Time} ➜ [\x1b[33mDebug\x1b[0m]: ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}\n`);
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем текущее время
 */
function currentTime(): string {
    const date = new Date();
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(DurationUtils.toFixed0).join(":");
    let ms = `${date.getMilliseconds()}`;

    if (ms.length === 1) ms = `00${ms}`;
    else if (ms.length === 2) ms = `0${ms}`;

    return `[${time}.${ms}]`;
}