import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from 'node:zlib';
import {request as httpsRequest, RequestOptions} from "https";
import {IncomingMessage, request as httpRequest} from "http";
import {getCookies, uploadCookie} from "./Cookie";
import UserAgents from "@db/UserAgents.json";

const decoderBase = {
    "gzip": createGunzip,
    "br": createBrotliDecompress,
    "deflate": createDeflate
};

//Поддержка запросов
const protocols = {
    "http": httpRequest,  //http запрос
    "https": httpsRequest //https запрос
};

export namespace httpsClient {
    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Настройки запроса
     * @requires {uploadCookie, getCookies}
     */
    export function Request(url: string, options: httpsClientOptions = {request: {headers: {}, method: "GET"}, options: {}}): Promise<IncomingMessage | Error> {
        //Добавляем User-Agent
        if (options.options?.userAgent) {
            const {Agent, Version} = GetUserAgent();

            if (Agent) options.request.headers = {...options.request.headers, "user-agent": Agent};
            if (Version) options.request.headers = {...options.request.headers, "sec-ch-ua-full-version": Version};
        }

        //Добавляем куки
        if (options.options?.cookie) {
            const cookie = getCookies();

            if (cookie) options.request.headers = {...options.request.headers, "cookie": cookie};
        }

        return new Promise((resolve) => {
            const {hostname, pathname, search, port} = new URL(url);
            const request = protocols[url.split("://")[0] as "https" | "http"]({ host: hostname, path: pathname + search, port, ...options.request }, (res: IncomingMessage) => {
                //Автоматическое перенаправление
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) return resolve(Request(res.headers.location, options));
                //Обновляем куки
                if (options?.options?.cookie && res.headers && res.headers["set-cookie"]) setImmediate(() => uploadCookie(res.headers["set-cookie"]));
                return resolve(res);
            });

            //Если возникла ошибка
            request.once("error", resolve);

            //Если запрос POST, отправляем ответ на сервер
            if (options?.request?.method === "POST") request.write(options.request?.body);

            //Заканчиваем запрос
            request.end();

            //Через 5 секунд после запроса уничтожаем запрос
            if (!options?.options?.keepAlive) setTimeout(() => {
                if (!request.destroyed) {
                    request.removeAllListeners();
                    request.destroy();
                }
            }, 5e3);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем страницу в формате string
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Настройки запроса
     * @requires {Request}
     */
    export function parseBody(url: string, options?: httpsClientOptions): Promise<string | Error> {
        return new Promise(async (resolve) => {
            const request = await Request(url, options);

            if (request instanceof Error) return resolve(request);

            const encoding = request.headers["content-encoding"] as "br" | "gzip" | "deflate";
            const decoder: Decoder | null = decoderBase[encoding] ? decoderBase[encoding]() : null;

            if (!decoder) return resolve(extractPage(request));
            return resolve(extractPage(request.pipe(decoder)));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Настройки запроса
     * @requires {parseBody}
     */
    export function parseJson(url: string, options?: httpsClientOptions): Promise<null | any> {
        return new Promise(async (resolve) => {
            const body = await parseBody(url, options);

            if (body instanceof Error) return resolve(null);

            try {
                return resolve(JSON.parse(body));
            } catch (e) { console.log(`[httpsClient]: Invalid json response body at ${url} reason: ${e.message}`); return resolve(null); }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем ссылку на работоспособность
     * @param url {string} Ссылка
     * @requires {Request}
     */
    export function checkLink(url: string): Promise<"OK" | "Fail"> | "Fail" {
        if (!url) return "Fail";

        return Request(url, {request: {method: "HEAD"}}).then((resource: IncomingMessage) => {
            if (resource instanceof Error) return "Fail"; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return "OK"; //Если возможно скачивать ресурс
            return "Fail"; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем рандомный user-agent и его версию
 */
function GetUserAgent(): { Agent: string, Version: string } {
    const MinAgents = Math.ceil(0);
    const MaxAgents = Math.floor(UserAgents.length - 1);

    //Сам агент
    const Agent = UserAgents[Math.floor(Math.random() * (MaxAgents - MinAgents + 1)) + MinAgents];
    //Версия агента
    const Version = Agent?.split("Chrome/")[1]?.split(" ")[0];

    return {Agent, Version};
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем всю страницу
 * @param decoder {Decoder | IncomingMessage}
 */
function extractPage(decoder: Decoder | IncomingMessage) {
    const data: string[] = [];

    return new Promise<string>((resolve) => {
        decoder.setEncoding("utf-8");
        decoder.on("data", (c) => data.push(c));
        decoder.once("end", () => {
            return resolve(data.join(""));
        });
    });
}
//====================== ====================== ====================== ======================
type Decoder = BrotliDecompress | Gunzip | Deflate;

// @ts-ignore
interface ReqOptions extends RequestOptions {
    body?: string;
    method?: "GET" | "POST" | "HEAD";
}

export interface httpsClientOptions {
    request?: ReqOptions;
    options?: {
        keepAlive?: boolean;
        userAgent?: boolean;
        cookie?: boolean;
    };
}