import {inPlaylist, inTrack} from "@Queue/Song";
import {httpsClient} from "@httpsClient";
import {APIs} from "@db/Config.json";
import {env} from "@env";

//====================== ====================== ====================== ======================
/**
 * Простая реализация API SoundCloud
 * ClientID не обязателен его можно просто так получить
 */
//====================== ====================== ====================== ======================

//Локальная база данных
const db = {
    api: "https://api-v2.soundcloud.com",

    clientID: env.get("SOUNDCLOUD")
};

/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Делаем запрос с привязкой ClientID
     * @param method {string} Ссылка
     */
    export function Request(method: string): Promise<{ result: any, ClientID: string } | Error> {
        return new Promise(async (resolve) => {
            const ClientID = await getClientID();

            if (ClientID instanceof Error || !ClientID) return resolve(Error("[APIs]: Невозможно получить ID клиента!"));

            const result = await httpsClient.parseJson(`${db.api}/${method}&client_id=${ClientID}`);

            if (!result) return resolve(Error("[APIs]: Невозможно найти данные!"));

            return resolve({ result, ClientID });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проходим все этапы для получения ссылки на поток трека
     * @param formats {SoundCloudFormat[]} Зашифрованные форматы аудио
     * @param ClientID {string} ID клиента
     */
    export function getFormat(formats: SoundCloudFormat[], ClientID: string): Promise<string> {
        const filterFormats = formats.filter((d) => d.format.protocol === "progressive").pop() ?? formats[0];

        return new Promise(async (resolve) => {
            const EndFormat = await httpsClient.parseJson(`${filterFormats.url}?client_id=${ClientID}`);

            return resolve(EndFormat.url);
        });
    }
}
//====================== ====================== ====================== ======================

/**
 * @description Формирование общих данных
 */
namespace construct {
    /**
     * @description Заготавливаем пример трека
     * @param track {any} Трек
     * @param url {string} Ссылка на трек
     */
    export function track(track: any, url?: string): inTrack {
        if (!track.user) return;

        return {
            url: url ?? track.permalink_url,
            title: track.title,
            author: author(track.user),
            image: parseImage(track.artwork_url),
            duration: { seconds: (track.duration / 1e3).toFixed(0) }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Заготавливаем пример автора
     * @param user {any} Автор
     */
    export function author(user: any) {
        return {
            url: user.permalink_url,
            title: user.username,
            image: parseImage(user.avatar_url),
            isVerified: user.verified
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем картинку в исходном качестве
     * @param image {string} Ссылка на картинку
     * @constructor
     */
    export function parseImage(image: string): { url: string } {
        if (!image) return {url: image};

        const imageSplit = image.split("-");
        const FormatImage = image.split(".").pop();

        imageSplit[imageSplit.length - 1] = "original";

        return {url: `${imageSplit.join("-")}.${FormatImage}`};
    }
}
//====================== ====================== ====================== ======================

/**
 * @description Какие запросы доступны (какие были добавлены)
 */
export namespace SoundCloud {
    /**
     * @description Получаем трек
     * @param url {string} Ссылка на трек
     */
    export function getTrack(url: string): Promise<inTrack> {
        return new Promise<inTrack>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`resolve?url=${url}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const {result, ClientID} = api;
                const format = await API.getFormat(result.media.transcodings, ClientID); //Получаем исходный файл музыки

                return resolve({...construct.track(result, url), format: {url: format}});
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем плейлист
     * @param url {string} Ссылка на плейлист
     */
    export function getPlaylist(url: string, options = {limit: APIs.limits.playlist}): Promise<inTrack | inPlaylist> {
        return new Promise<inPlaylist | inTrack>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`resolve?url=${url}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const {result} = api;

                //Если треков нет значит, это ссылка на трек, а не на плейлист
                if (result.tracks === undefined) return getTrack(url).then(resolve);
                const tracks = result.tracks.splice(0, options.limit);

                return resolve({ url, title: result.title,
                    author: construct.author(result.user),
                    image: construct.parseImage(result.artwork_url),
                    items: tracks.map(construct.track)
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки в soundcloud
     * @param search {string} Что ищем
     * @param options {limit: number} Кол-во выдаваемых треков
     * @constructor
     */
    export function SearchTracks(search: string, options = {limit: APIs.limits.search}): Promise<inTrack[]> {
        return new Promise<inTrack[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`search/tracks?q=${search}&limit=${options.limit}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const {result} = api;
                return resolve(result.collection.map(construct.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Если нет ClientID то получаем его как неавторизованный пользователь
 * @private
 */
function getClientID(): Promise<string | Error> | string {
    if (db.clientID) return db.clientID;

    return new Promise(async (resolve) => {
        const parsedPage = await httpsClient.parseBody("https://soundcloud.com/", {
            options: { userAgent: true },
            request: {
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }
            }
        });

        if (!parsedPage || parsedPage instanceof Error) return resolve(Error("[APIs]: Не удалось получить ClientID!"));

        const split = parsedPage.split("<script crossorigin src=\"");
        const urls: string[] = [];

        split.forEach((r) => r.startsWith("https") ? urls.push(r.split("\"")[0]) : null);

        const parsedPage2 = await httpsClient.parseBody(urls.pop());

        if (parsedPage2 instanceof Error) return resolve(Error("[APIs]: Не удалось получить ClientID!"));
        return resolve(parsedPage2.split(",client_id:\"")[1].split("\"")[0]);
    });
}

interface SoundCloudFormat {
    url: string,
    preset: "mp3_0_0" | "opus_0_0",
    duration: number,
    snipped: boolean,
    format: {
        protocol: "hls" | "progressive",
        mime_type: "audio/mpeg"
    },
    quality: "sq"
}