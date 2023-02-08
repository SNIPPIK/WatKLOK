import {inPlaylist, inTrack} from "@Structures/Queue/Song";
import * as querystring from "querystring";
import {httpsClient} from "@httpsClient";
import crypto from "node:crypto";
import {env} from "@env";

//====================== ====================== ====================== ======================
//                            Простая реализация API yandex music                          //
//====================== ====================== ====================== ======================

const aut = env.get("YANDEX")?.split(":") ?? [null, null];
//Локальная база данных с данными для авторизации
const data = {
    "api": "https://api.music.yandex.net",
    "auth": "https://oauth.mobile.yandex.net",
    "oauth": {
        "CLIENT_ID": "23cabbbdc6cd418abb4b39c32c41195d",
        "CLIENT_SECRET": "53bc75238f0c4d08a118e51fe9203300"
    }
};

//Локальная база данных
const db = {
    password: aut[1],
    username: aut[0],

    token: "",
    uid: 0,
    time: 0
};

/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
    export function Request(method: string) {
        return new Promise<any | Error>(async (resolve) => {
            if (!db.password || !db.username) return resolve(Error("[APIs]: Authorization has not found, need username:password"));

            const isLoggedIn = db.token !== undefined && db.time > Date.now() + 2;
            if (!isLoggedIn) await getAuthorization();

            const req = await httpsClient.parseJson(`${data.api}/${method}`, {
                request: {
                    headers: {
                        "Authorization": "OAuth " + db.token
                    }
                }
            });

            if (!req) return resolve(Error("[APIs]: Не удалось получить данные!"));

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
    export function track(track: any): inTrack {
        const author = track.artists?.length ? track.artists?.pop() : track.artists;
        const image = {url: onImage(track?.ogImage || track?.coverUri) };
        const album = track.albums?.length ? track.albums[0] : track.albums;
        const title = `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : "");

        return {
            title, image,

            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            duration: {seconds: (track.durationMs / 1000).toFixed(0)},

            author: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: {url: onImage(author?.ogImage ?? author?.coverUri)},
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
    export function onImage(image: string, size = 400) {
        if (!image) return "";

        let img = image.split("%%")[0];

        return `https://${img}${size}x${size}`;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходный файл трека
     * @param ID {string} ID трека
     */
    export function getMp3(ID: string) {
        return new Promise<string | Error>(async (resolve) => {
            const api = await API.Request(`tracks/${ID}/download-info`);
            const track = api.pop();

            const body = await httpsClient.parseBody(track.downloadInfoUrl);

            if (body instanceof Error) return resolve(body);

            const host = body.split("<host>")[1].split("</host>")[0];
            const path = body.split("<path>")[1].split("</path>")[0];
            const ts = body.split("<ts>")[1].split("</ts>")[0];
            const s = body.split("<s>")[1].split("</s>")[0];
            const sign = crypto.createHash("md5").update("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + s).digest("hex");

            return resolve(`https://${host}/get-mp3/${sign}/${ts}${path}`);
        })
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
    export function getTrack(url: string): Promise<inTrack> {
        const ID = url.split(/[^0-9]/g).filter(str => str !== "");

        return new Promise(async (resolve, reject)=> {
            if (ID.length < 2) return reject(Error("[APIs]: Не найден ID трека!"));

            const api = await API.Request(`tracks/${ID[1]}`);

            if (api instanceof Error) return reject(api);

            const track = api[0];
            const audio = await construct.getMp3(ID[1]);
            track.author = await getAuthor(track?.artists[0].id);

            if (audio instanceof Error) return resolve(construct.track(track));
            return resolve({...construct.track(track), format: {url: audio}});
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об альбоме
     * @param url {string} Ссылка на альбом
     */
    export function getAlbum(url: string): Promise<inPlaylist> {
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
                const Author = await getAuthor(api.artists[0]?.id);
                const tracks: inTrack[] = [];
                let NumberTrack = 0;

                for (const track of findTracks) {
                    if (NumberTrack === 50) break;

                    NumberTrack++;
                    tracks.push(construct.track(track));
                }

                return resolve({
                    url, title: api.title, image: {url: AlbumImage}, author: Author,
                    items: tracks
                })
            } catch (e) { console.log(e); return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем 5 популярных треков автора
     * @param url {string} Ссылка на автора
     */
    export function getArtistTracks(url: string): Promise<inTrack[]> {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID автора не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

            try {
                //Создаем запрос
                const api = await API.Request(`artists/${ID}/tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks: inTrack[] = [];
                let NumberTrack = 0;

                for (const track of api.tracks) {
                    if (NumberTrack === 5) break;

                    NumberTrack++;
                    tracks.push(construct.track(track))
                }

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки на yandex music
     * @param str {string} Что надо искать
     * @constructor
     */
    export function SearchTracks(str: string): Promise<inTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`search?type=all&text=${str.split(" ").join("%20")}&page=0&nococrrect=false`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const tracks: inTrack[] = [];
                let NumberTrack = 0;

                for (const track of api.tracks.results) {
                    if (NumberTrack === 15) break;

                    NumberTrack++;
                    tracks.push(construct.track(track))
                }

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные об авторе трека
 * @param ID {string} ID автора
 */
function getAuthor(ID: string): Promise<inTrack["author"]> {
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

            return resolve({url: `https://music.yandex.ru/artist/${ID}`, title: author.name, image: {url: image}, isVerified: true });
        } catch (e) { console.log(e); return reject(Error(`[APIs]: ${e}`)) }
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные для дальнейших запросов
 */
function getAuthorization() {
    return httpsClient.parseJson(`${data.auth}/1/token`, {
        request: {
            method: "POST",
            body: querystring.stringify({
                grant_type: "password",
                username: db.username,
                password: db.password,
                client_id: data.oauth.CLIENT_ID,
                client_secret: data.oauth.CLIENT_SECRET,
            })
        }
    }).then(req => {
        db.time = Date.now() + req.expires_in;
        db.token = req.access_token;
        db.uid = req.uid;
    })
}