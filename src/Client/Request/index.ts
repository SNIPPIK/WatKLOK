import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {request as httpsRequest, RequestOptions} from "https";
import {IncomingMessage, request as httpRequest} from "http";
import {Duration} from "@Client/Audio";
import {Logger} from "@Client";

/**
 * @author SNIPPIK
 * @description Класс создающий запрос
 * @class Request
 * @abstract
 */
abstract class Request {
    protected readonly _options: { body?: string; } & RequestOptions;
    /**
     * @description Получаем протокол ссылки
     * @private
     */
    private get protocol() {
        const protocol = this._options.protocol?.split(":")[0];

        if (protocol === "http") return httpRequest;
        else return httpsRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise(async (resolve) => {
            Logger.log("DEBUG", `httpsClient: [${this._options.method}:|${this._options.hostname}${this._options.path}]`);

            const request = this.protocol(this._options, (res: IncomingMessage) => {
                //Автоматическое перенаправление
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) {
                    this._options.path = res.headers.location;
                    return resolve(this.request);
                }

                return resolve(res);
            });

            //Если запрос получил ошибку
            request.once("error", resolve);
            request.once("timeout", () => resolve(Error(`[APIs]: Connection Timeout Exceeded ${this._options?.hostname}:${this._options?.port ?? 443}`)));
            request.once("close", () => {
                request.removeAllListeners();
                request.destroy();
            });

            //Если запрос POST, отправляем ответ на сервер
            if (this._options.method === "POST" && this._options.body) request.write(this._options.body);

            request.end();
        });
    };

    /**
     * @description Получаем всю страницу
     * @param decoder {Decoder | IncomingMessage}
     * @private
     */
    protected _extractPage = (decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage): Promise<string> => {
        const data: string[] = [];

        return new Promise<string>((resolve) => {
            decoder.setEncoding("utf-8");
            decoder.on("data", (c) => data.push(c));
            decoder.once("end", () => {
                return resolve(data.join(""));
            });
        });
    };

    /**
     * @description Инициализируем класс
     * @param url {string} Ссылка
     * @param options {any} Опции
     * @public
     */
    public constructor(
        url: string,
        options?: { method?: "POST" | "GET" | "HEAD";
            //Headers запроса
            headers?: RequestOptions["headers"];

            //Если мы хотим что-то отправить серверу
            body?: string;

            //Добавлять рандомный user-agent
            useragent?: boolean;
        }
    ) {
        const { hostname, pathname, search, port, protocol } = new URL(url);
        let headers = options?.headers ?? {};

        //Добавляем фейковые данные о клиенте
        if (options?.useragent) {
            const OS = [ "(X11; Linux x86_64)", "(Windows NT 10.0; Win64; x64)" ];
            const version = `${Duration.randomNumber(96, 120)}.0.6099.${Duration.randomNumber(20, 250)}`;

            headers = {
                "User-Agent": `Mozilla/5.0 ${OS[Duration.randomNumber(0, OS.length)]} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
                "Sec-Ch-Ua-Full-Version": version,
                "Sec-Ch-Ua-Bitness": `64`,
                "Sec-Ch-Ua-Arch": "x86",
                "Sec-Ch-Ua-Mobile": "?0"
            };
        }

        this._options = {
            method: options?.method ?? "GET", hostname,
            path: pathname + search, port, headers,
            body: options?.body,
            protocol: protocol
        };
    };
}

/**
 * @author SNIPPIK
 * @description Создаем http или https запрос
 * @class httpsClient
 */
export class httpsClient extends Request {
    /**
     * @description Получаем страницу в формате string
     * @requires {request}
     * @public
     */
    public get toString(): Promise<string | Error> {
        return new Promise((resolve) => this.request.then((request) => {
            if (request instanceof Error) return resolve(request);

            const encoding = request.headers["content-encoding"];
            switch (encoding) {
                case "br": return resolve(this._extractPage(request.pipe(createBrotliDecompress())));
                case "gzip": return resolve(this._extractPage(request.pipe(createGunzip())));
                case "deflate": return resolve(this._extractPage(request.pipe(createDeflate())));
                default: return resolve(this._extractPage(request));
            }
        }));
    };

    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @requires {toString}
     * @public
     */
    public get toJson(): Promise<null | any | Error> {
        return new Promise((resolve) => this.toString.then((body) => {
            if (body instanceof Error) return resolve(null);

            try {
                return resolve(JSON.parse(body));
            } catch (e) {
                Logger.log("ERROR", `[httpsClient]: Invalid json response body at ${this._options.hostname} reason: ${e.message}`);
                return resolve(null);
            }
        }));
    };

    /**
     * @description Проверяем ссылку на работоспособность
     * @requires {request}
     * @public
     */
    public get status(): Promise<boolean> | false {
        return this.request.then((resource: IncomingMessage) => {
            if (resource instanceof Error) return false; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return true; //Если возможно скачивать ресурс
            return false; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    };

    /**
     * @description Берем данные из XML страницы
     * @public
     */
    public get toXML(): Promise<Error | string[]> {
        return this.toString.then((body) => {
            if (body instanceof Error) return Error("Not found XML data!");

            return body.split(/<[a-zA-Z]+>(.*?)<\/[a-zA-Z]+>/g).filter((text) =>
                text !== "" && !text.match(/xml version/g) && !text.match(/<\//)
            );
        });
    };
}