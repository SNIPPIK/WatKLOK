import {env} from "@env";

/**
 * @description Сохраняем куки в json файл
 * @param Cookie {string | string[]} Что нужно добавить к текущему куки
 */
export function uploadCookie(Cookie: string | string[]): void {
    try {
        const CookieFile: string = env.get("bot.youtube.cookie");

        if (!CookieFile) return;

        const newCookie: string = ParsingCookieToString({ ...ParsingCookieToJson(CookieFile), ...ParsingCookieToJson(Cookie) });

        env.set("bot.youtube.cookie", newCookie);
    } catch (err) { throw Error("[APIs]: Cookie file has damaged!"); }
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем из строки json
 * @param headCookie {string[] | string} Что нужно добавить к текущему куки
 */
function ParsingCookieToJson(headCookie: string[] | string): {} {
    let Json = {};

    //Разбираем куки в JSON
    const filteredCookie = (cook: string) => cook.split(";").forEach((cookie) => {
        const arrayCookie = cookie.split("=");

        //Если параметра нет, то не добавляем его
        if (arrayCookie.length <= 1) return;

        const key: string = arrayCookie.shift()?.trim().toUpperCase();
        const value: string = arrayCookie.join("=").trim();

        Json = { ...Json, [key]: value };
    });

    if (typeof headCookie === "string") filteredCookie(headCookie);
    else headCookie.forEach(filteredCookie);

    return Json;
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем из json формата строку
 * @param JsonCookie {object} Json куки
 */
function ParsingCookieToString(JsonCookie: {}) {
    let result: string[] = [];

    for (const [key, value] of Object.entries(JsonCookie)) result.push(`${key}=${value}`);
    return result.join("; ");
}