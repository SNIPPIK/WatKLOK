import { DurationUtils } from "@Structures/Durations";

export namespace Logger {
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     * @param isDebug {boolean} Добавить префикс Debug
     */
    export function log(text: string): void {
        const Time = currentTime();

        return console.log(`${Time} ➜ ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}`);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем и красным текстом
     * @param text {string} Текст лога
     */
    export function error(text: string): void {
        const Time = currentTime();

        return console.log(`${Time} ➜ [\x1b[31mError\x1b[0m]: \x1b[31m${text}\x1b[0m`);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     * @param isDebug {boolean} Добавить префикс Debug
     */
    export function debug(text: string): void {
        const Time = currentTime();

        return console.log(`${Time} ➜ [\x1b[33mDebug\x1b[0m]: ${text.replace(/\[/gi, "[\x1b[32m").replace(/]/gi, "\x1b[0m]")}`);
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