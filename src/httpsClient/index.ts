import {ReqOptions, Request} from "./Structures/Request";
import {GetUserAgent} from "./Structures/Utils";
import {getCookies} from "./Structures/Cookie";
import {IncomingMessage} from "http";

const RequestType = {
    "body": Request.parseBody,
    "json": Request.parseJson,
    "all": Request.Request
};

type resolveClient = any | Error;

export namespace httpsClient {
    /**
     * @description Делаем GET запрос
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Доп настройки
     */
    export function get(url: string, options: httpsClientOptions): Promise<resolveClient> {
        return runRequest(url, "GET", options.resolve, options);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Делаем POST запрос
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Доп настройки
     */
    export function post(url: string, options: httpsClientOptions): Promise<resolveClient> {
        return runRequest(url, "POST", options.resolve, options);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Делаем HEAD запрос
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Доп настройки
     */
    export function head(url: string, options: httpsClientOptions): Promise<resolveClient> {
        return runRequest(url, "HEAD", "all", options);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем ссылку на работоспособность
     * @param url {string} Ссылка
     * @requires {Request}
     */
    export function checkLink(url: string): Promise<"OK" | "Fail"> | "Fail" {
        if (!url) return "Fail";

        return head(url, {resolve: "body", useragent: true}).then((resource: IncomingMessage) => {
            if (resource instanceof Error) return "Fail"; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return "OK"; //Если возможно скачивать ресурс
            return "Fail"; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем запрос из требований
 * @param url {string} Ссылка
 * @param method {string} Метод зпроса
 * @param type {string} Тип выдачи данных
 * @param options {httpsClientOptions} Доп настройки
 */
function runRequest(url: string, method: "GET" | "POST" | "HEAD", type: "all" | "body" | "json", options: httpsClientOptions) {
    const {hostname, pathname, search, port, protocol} = new URL(url);
    let headers = options.headers ?? {};

    //Добавляем User-Agent
    if (options.useragent) {
        const {Agent, Version} = GetUserAgent();

        if (Agent) headers = {...headers, "user-agent": Agent};
        if (Version) headers = {...headers, "sec-ch-ua-full-version": Version};
    }

    //Добавляем куки
    if (options?.cookie) {
        const cookie = getCookies();

        if (cookie) headers = {...headers, "cookie": cookie};
    }

    return RequestType[type]({method, hostname, path: pathname + search, port, headers, body: options?.body, protocol: protocol});
}

interface httpsClientOptions {
    //Тип выдаваемых данных
    resolve: "body" | "json";

    //Headers запроса
    headers?: ReqOptions["headers"];

    //Если мы хотим что-то отправить серверу
    body?: string;

    //Добавлять рандомный user-agent
    useragent?: boolean;

    //Использовать Cookie
    cookie?: boolean;

    //Использовать прокси (Пока не работает)
    proxy?: boolean;
}