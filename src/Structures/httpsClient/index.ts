import { RequestOptions, Request, method } from "./Structures/Request";
import { getUserAgent } from "./Structures/Utils";
import { getCookies } from "./Structures/Cookie";
import { IncomingMessage } from "http";

type RequestType = "string" | "json" | "full";
//Как можно получить данные
const RequestType = {
    "string": Request.parseBody,
    "json": Request.parseJson,
    "full": Request.Request
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
        return runRequest(url, "HEAD", options.resolve, options);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем ссылку на работоспособность
     * @param url {string} Ссылка
     * @requires {Request}
     */
    export function checkLink(url: string): Promise<boolean> | false {
        if (!url) return false;

        return head(url, { resolve: "full", useragent: true }).then((resource: IncomingMessage) => {
            if (resource instanceof Error) return false; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return true; //Если возможно скачивать ресурс
            return false; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Парсим XML страницу в string[]
     * @param url {string} Ссылка на xml
     */
    export function parseXML(url: string) {
        return new Promise(async (resolve) => {
            const body: string | Error = await get(url, { resolve: "string" });

            if (body instanceof Error) return resolve(Error(`Not found XML data!`));

            const filter = body.split(/<[a-zA-Z]+>(.*?)<\/[a-zA-Z]+>/g).filter(text => text !== "" && !text.match(/xml version/g) && !text.match(/<\//));

            return resolve(filter);
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
function runRequest(url: string, method: method, type: RequestType, options: httpsClientOptions): Promise<any> {
    const { hostname, pathname, search, port, protocol } = new URL(url);
    let headers = options.headers ?? {};
    let reqOptions: RequestOptions = { method, hostname, path: pathname + search, port, headers, body: options?.body, protocol: protocol }

    //Добавляем User-Agent
    if (options.useragent) {
        const { Agent, Version } = getUserAgent();

        if (Agent) headers = { ...headers, "user-agent": Agent };
        if (Version) headers = { ...headers, "sec-ch-ua-full-version": Version };
    }

    //Добавляем куки
    if (options?.cookie) {
        const cookie = getCookies();

        if (cookie) headers = { ...headers, "cookie": cookie };
    }

    if (type === "json") {
        headers = { ...headers, 'Content-Type': 'application/json' };
    }

    return RequestType[type](reqOptions);
}

interface httpsClientOptions {
    //Тип выдаваемых данных
    resolve: RequestType;

    //Headers запроса
    headers?: RequestOptions["headers"];

    //Если мы хотим что-то отправить серверу
    body?: string;

    //Добавлять рандомный user-agent
    useragent?: boolean;

    //Использовать Cookie
    cookie?: boolean;
}