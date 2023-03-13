import { ISong } from "@Structures/Queue/Song";
import { httpsClient } from "@httpsClient";
import { APIs } from "@db/Config.json"
import crypto from "node:crypto";
import { env } from "@env";

//====================== ====================== ====================== ======================
//                            Простая реализация API yandex music                          //
//====================== ====================== ====================== ======================

//Локальная база данных
const db = {
    token: env.get("YANDEX"),

    api: "https://api.music.yandex.net",
    link: "https://music.yandex.ru"
};
//====================== ====================== ====================== ======================
/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
    export function Request(method: string): Promise<any> {
        return new Promise<any | Error>(async (resolve) => {

            const req = await httpsClient.get(`${db.api}/${method}`, {
                resolve: "json",
                headers: {
                    "Authorization": "OAuth " + db.token
                }
            });

            if (!req) return resolve(Error("[APIs]: Не удалось получить данные!"));
            else if (!db.token) return resolve(Error("[APIs]: Не удалось залогинится!"));

            if (req?.result) return resolve(req?.result);
            return resolve(req);
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Формирование общих данных
 */
namespace construct {
    /**
     * @description Из полученных данных заготовляваем трек для AudioPlayer<Queue>
     * @param video {any} Любой трек с Yandex Music
     */
    export function track(track: any): ISong.track {
        const author = track.artists?.length ? track.artists?.pop() : track.artists;
        const image = { url: onImage(track?.ogImage || track?.coverUri) };
        const album = track.albums?.length ? track.albums[0] : track.albums;
        const title = `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : "");

        return {
            title, image,

            url: `${db.link}/album/${album.id}/track/${track.id}`,
            duration: { seconds: (track.durationMs / 1000).toFixed(0) },

            author: track.author ?? {
                title: author?.name,
                url: `${db.link}/artist/${author.id}`,
                image: { url: onImage(author?.ogImage ?? author?.coverUri) },
                isVerified: true
            }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Расшифровываем картинку
     * @param image {string} Ссылка на картинку
     * @param size {number} Размер картинки
     */
    export function onImage(image: string, size = 1e3): string {
        if (!image) return "";

        let img = image.split("%%")[0];

        return `https://${img}m${size}x${size}`;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходный файл трека
     * @param ID {string} ID трека
     */
    export function getMp3(ID: string): Promise<string | Error> {
        return new Promise<string | Error>(async (resolve) => {
            try {
                const api = await API.Request(`tracks/${ID}/download-info`);

                if (!api || api instanceof Error) return resolve(Error("[APIs]: Not found links for track!"));

                const track = api?.pop() ?? api;
                const body = await httpsClient.get(track.downloadInfoUrl, { resolve: "string" });

                if (body instanceof Error) return resolve(body);

                const host = body.split("<host>")[1].split("</host>")[0];
                const path = body.split("<path>")[1].split("</path>")[0];
                const ts = body.split("<ts>")[1].split("</ts>")[0];
                const s = body.split("<s>")[1].split("</s>")[0];
                const sign = crypto.createHash("md5").update("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + s).digest("hex");

                return resolve(`https://${host}/get-mp3/${sign}/${ts}${path}`);
            } catch (e) { return resolve(Error(e)); }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Какие запросы доступны
 */
export namespace YandexMusic {
    /**
     * @description Получаем данные о треке
     * @param url {string} Ссылка на трек
     */
    export function getTrack(url: string): Promise<ISong.track> {
        const ID = url.split(/[^0-9]/g).filter(str => str !== "");

        return new Promise(async (resolve, reject) => {
            try {
                if (ID.length < 2) return reject(Error("[APIs]: Не найден ID трека!"));

                const api = await API.Request(`tracks/${ID[1]}`);

                if (api instanceof Error) return reject(api);

                const track = api[0];
                const audio = await construct.getMp3(ID[1]);
                track.author = await getAuthor(track?.artists[0].id);

                if (audio instanceof Error) return resolve(construct.track(track));
                return resolve({ ...construct.track(track), format: { url: audio } });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об альбоме
     * @param url {string} Ссылка на альбом
     * @param options {limit: number} Настройки
     */
    export function getAlbum(url: string, options = { limit: APIs.limits.playlist }): Promise<ISong.playlist> {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID альбома не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

            try {
                //Создаем запрос
                const api = await API.Request(`albums/${ID}/with-tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                else if (!api?.duplicates?.length && !api?.volumes?.length) return reject(Error("[APIs]: Я не нахожу треков в этом альбоме!"));

                const findTracks = (api.duplicates ?? api.volumes)?.pop();
                const AlbumImage = construct.onImage(api?.ogImage ?? api?.coverUri);
                const tracks: ISong.track[] = findTracks.splice(0, options.limit);;
                const Author = await getAuthor(api.artists[0]?.id);

                return resolve({ url, title: api.title, image: { url: AlbumImage }, author: Author, items: tracks.map(construct.track) });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем 5 популярных треков автора
     * @param url {string} Ссылка на автора
     */
    export function getArtistTracks(url: string, options = { limit: APIs.limits.author }): Promise<ISong.track[]> {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID автора не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

            try {
                //Создаем запрос
                const api = await API.Request(`artists/${ID}/tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks = api.tracks.splice(0, options.limit);

                return resolve(tracks.map(construct.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки на yandex music
     * @param str {string} Что надо искать
     * @constructor
     */
    export function SearchTracks(str: string, options = { limit: APIs.limits.search }): Promise<ISong.track[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`search?type=all&text=${str.split(" ").join("%20")}&page=0&nococrrect=false`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если нет треков с таким названием
                if (!api.tracks) return reject(Error(`[APIs]: На Yandex music нет такого трека!`));

                const tracks = api.tracks.results.splice(0, options.limit);

                return resolve(tracks.map(construct.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные об авторе трека
 * @param ID {string} ID автора
 */
function getAuthor(ID: string): Promise<ISong.author> {
    return new Promise(async (resolve, reject) => {
        if (!ID) return resolve(null);

        try {
            //Создаем запрос
            const api = await API.Request(`artists/${ID}`);

            //Если запрос выдал ошибку то
            if (api instanceof Error) return reject(api);

            //Если мы получаем эту ошибку, то автора не существует
            if (api?.error && api?.error?.name === "unknown") return resolve(null);

            const author = api.artist;
            const image = construct.onImage(author?.ogImage);

            return resolve({ url: `https://music.yandex.ru/artist/${ID}`, title: author.name, image: { url: image }, isVerified: true });
        } catch (e) { return null }
    });
}