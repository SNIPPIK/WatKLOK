import { BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip } from "node:zlib";
import { request as httpsRequest, RequestOptions as ReqOptions } from "https";
import { IncomingMessage, request as httpRequest } from "http";
import {getUserAgent} from "./Structures/Utils";
import {httpsAgent} from "./Structures/Proxy";
import {Cookie} from "./Structures/Cookie";
import { Logger } from "@Logger";
import {env} from "@env";

const useProxy = env.get("APIs.proxy");
const debug = env.get("debug.request");
const CookieManager = new Cookie();

/**
 * @description Варианты расшифровки
 */
const decoderBase = {
    "gzip": createGunzip,
    "br": createBrotliDecompress,
    "deflate": createDeflate
};


/**
 * @description Доступные запросы
 */
const protocols = {
    "http": httpRequest,  //http запрос
    "https": httpsRequest //https запрос
};


export class httpsClient {
    private _options: RequestOptions;
    private _proxy: boolean;

    /**
     * @description Получаем протокол ссылки
     */
    private get protocol() { return protocols[this._options.protocol?.split(":")[0] as "http" | "https"]; };


    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
            if (this._proxy) {
                new httpsAgent(`${this._options.hostname}`).Agent.then((Agent) => {
                    if (Agent) this._options = {...this._options, agent: Agent};
                });
            }

            if (debug) Logger.debug(`httpsClient: [${this._options.method}] | [${this._options.hostname}${this._options.path}]`);

            const request = this.protocol(this._options, (res: IncomingMessage) => {
                //Автоматическое перенаправление
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) {
                    this._options = {...this._options, path: res.headers.location };
                    return resolve(this.request);
                }

                //Обновляем куки
                if (this._options?.headers["cookie"] && res.headers && res.headers["set-cookie"]) {
                    setTimeout(() => CookieManager.update = res.headers["set-cookie"], 200);
                }

                return resolve(res);
            });

            //Если запрос получил ошибку
            request.once("error", resolve);
            request.once("timeout", () => resolve(Error(`[APIs]: Connection Timeout Exceeded ${this._options?.hostname}:${this._options?.port ?? 443}`)));
            request.once("close", this.cleanup);

            //Если запрос POST, отправляем ответ на сервер
            if (this._options.method === "POST" && this._options.body) request.write(this._options.body);

            request.end();
        });
    };


    /**
     * @description Получаем страницу в формате string
     * @requires {request}
     */
    public get toString(): Promise<string | Error> {
        return new Promise((resolve) => this.request.then((request) => {
            if (request instanceof Error) return resolve(request);

            const encoding = request.headers["content-encoding"] as "br" | "gzip" | "deflate";
            const decoder: Decoder | null = decoderBase[encoding] ? decoderBase[encoding]() : null;

            if (!decoder) return resolve(extractPage(request));
            return resolve(extractPage(request.pipe(decoder)));
        }));
    };


    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @requires {toString}
     */
    public get toJson(): Promise<null | any | Error> {
        return new Promise((resolve) => this.toString.then(body => {
            if (body instanceof Error) return resolve(null);

            try {
                return resolve(JSON.parse(body));
            } catch (e) {
                Logger.error(`[httpsClient]: Invalid json response body at ${this._options.hostname} reason: ${e.message}`);
                return resolve(null);
            }
        }));
    };


    /**
     * @description Проверяем ссылку на работоспособность
     * @requires {request}
     */
    public get status(): Promise<boolean> | false {
        return this.request.then((resource: IncomingMessage) => {
            if (resource instanceof Error) return false; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return true; //Если возможно скачивать ресурс
            return false; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    };


    /**
     * @description Парсим XML страницу в string[]
     */
    public get toXML(): Promise<Error | string[]> {
        return new Promise(async (resolve) => {
            const body: string | Error = await this.toString;

            if (body instanceof Error) return resolve(Error(`Not found XML data!`));

            const filter = body.split(/<[a-zA-Z]+>(.*?)<\/[a-zA-Z]+>/g).filter((text) =>
                text !== "" && !text.match(/xml version/g) && !text.match(/<\//)
            );

            return resolve(filter);
        });
    };


    /**
     * @description Инициализируем класс
     * @param url {string} Ссылка
     * @param options {RequestOptions} Опции
     */
    public constructor(url: string, options?: httpsClientOptions) {
        const { hostname, pathname, search, port, protocol } = new URL(url);
        let headers = options?.headers ?? {};
        let reqOptions: RequestOptions = { method: options?.method ?? "GET", hostname, path: pathname + search, port, headers, body: options?.body, protocol: protocol }

        //Добавляем User-Agent
        if (options?.useragent) {
            const { Agent, Version } = getUserAgent();

            if (Agent) headers = { ...headers, "user-agent": Agent };
            if (Version) headers = { ...headers, "sec-ch-ua-full-version": Version };
        }

        //Добавляем куки
        if (options?.cookie) {
            const cookie = env.get("bot.cookie.youtube");

            if (cookie) headers = { ...headers, "cookie": cookie };
        }

        //Добавляем proxy connection
        if (options?.proxy && useProxy) this._proxy = true;

        this._options = {...reqOptions, headers};
    };


    /**
     * @description Очищаем класс
     */
    private cleanup = () => {
        delete this._options;
        delete this._proxy;
    };
}


/**
 * @description Получаем всю страницу
 * @param decoder {Decoder | IncomingMessage}
 */
function extractPage(decoder: Decoder | IncomingMessage): Promise<string> {
    const data: string[] = [];

    return new Promise<string>((resolve) => {
        decoder.setEncoding("utf-8");
        decoder.on("data", (c) => data.push(c));
        decoder.once("end", () => {
            return resolve(data.join(""));
        });
    });
}



/**
 * @description Допустимые запросы
 */
type method = "POST" | "GET" | "HEAD";
/**
 * @description Варианты расшифровки
 */
type Decoder = BrotliDecompress | Gunzip | Deflate;
/**
 * @description Опции запроса
 */
interface RequestOptions extends ReqOptions {
    body?: string;
    method?: method;
}
/**
 * @description Как подготовить запрос
 */
interface httpsClientOptions {
    method?: method;

    //Headers запроса
    headers?: ReqOptions["headers"];

    //Если мы хотим что-то отправить серверу
    body?: string;

    //Добавлять рандомный user-agent
    useragent?: boolean;

    //Использовать Cookie
    cookie?: boolean;

    proxy?: boolean;
}