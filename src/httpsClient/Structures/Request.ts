import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {request as httpsRequest, RequestOptions} from "https";
import {IncomingMessage, request as httpRequest} from "http";
import {uploadCookie} from "./Cookie";

const decoderBase = {
    "gzip": createGunzip,
    "br": createBrotliDecompress,
    "deflate": createDeflate
};
//Доступные запросы
const protocols = {
    "http": httpRequest,  //http запрос
    "https": httpsRequest //https запрос
};

export namespace Request {
    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Настройки запроса
     * @requires {uploadCookie, getCookies}
     */
    export function Request(options: ReqOptions): Promise<IncomingMessage | Error> {
        const protocol = options.protocol?.split(":")[0] as "http" | "https";

        return new Promise((resolve) => {
            const request = protocols[protocol](options, (res) => {
                //Автоматическое перенаправление
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) return resolve(Request({...options, path: res.headers.location }));

                //Обновляем куки
                if (options.headers["cookie"] && res.headers && res.headers["set-cookie"]) setImmediate(() => uploadCookie(res.headers["set-cookie"]));

                return resolve(res);
            });
            //Если запрос получил ошибку
            request.once("error", resolve);

            //Если запрос POST, отправляем ответ на сервер
            if (options.method === "POST" && options.body) request.write(options.body);

            request.end();

            /*
            //Через 5 секунд после запроса уничтожаем запрос
            setTimeout(() => {
                if (!request.destroyed) {
                    request.removeAllListeners();
                    request.destroy();
                }
            }, 5e3);
            */
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем страницу в формате string
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Настройки запроса
     * @requires {Request}
     */
    export function parseBody(options?: ReqOptions): Promise<string | Error> {
        return new Promise(async (resolve) => {
            const request = await Request(options);

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
    export function parseJson(options?: ReqOptions): Promise<null | any> {
        return new Promise(async (resolve) => {
            const body = await parseBody(options);

            if (body instanceof Error) return resolve(null);

            try {
                return resolve(JSON.parse(body));
            } catch (e) {
                console.log(`[httpsClient]: Invalid json response body at ${options.host} reason: ${e.message}`);
                return resolve(null);
            }
        });
    }
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

type Decoder = BrotliDecompress | Gunzip | Deflate;
export interface ReqOptions extends RequestOptions {
    body?: string;
    method?: "POST" | "GET" | "HEAD";
}