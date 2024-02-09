import {RequestAPI, ItemRequestAPI} from "@handler";
import {Song} from "@watklok/player/queue/Song";
import {httpsClient} from "@Client/Request";
import {env} from "@env";

//Локальная база данных
const ldb = {
    token: "",
    time: 0,

    api: "https://api.spotify.com/v1",
    link: "https://open.spotify.com",
    account: "https://accounts.spotify.com/api",
    aut: Buffer.from(env.get("token.spotify")).toString("base64")
};

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
export default class extends RequestAPI {
    public constructor() {
        super({
            name: "SPOTIFY",
            audio: false,
            auth: env.check("token.spotify"),

            color: 1420288,
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi,
            url: "open.spotify.com",

            requests: [

                /**
                 * @description Запрос данных о треке
                 */
                new class extends ItemRequestAPI {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /track/i,
                            callback: (url: string) => {
                                const ID = SpotifyLib.getID(url);

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID трека не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const api = await SpotifyLib.API(`tracks/${ID}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve(SpotifyLib.track(api));
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных об альбоме
                 */
                new class extends ItemRequestAPI {
                    public constructor() {
                        super({
                            name: "album",
                            filter: /album/i,
                            callback: (url: string) => {
                                const ID = SpotifyLib.getID(url);

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID альбома не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID альбома!"));

                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await SpotifyLib.API(`albums/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve({
                                            url, title: api.name, image: api.images[0],
                                            items: await Promise.all(api.tracks.items.map(SpotifyLib.track)),
                                            author: api?.["artists"][0]
                                        });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных об плейлисте
                 */
                new class extends ItemRequestAPI {
                    public constructor() {
                        super({
                            name: "playlist",
                            filter: /playlist/i,
                            callback: (url: string) => {
                                const ID = SpotifyLib.getID(url);

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await SpotifyLib.API(`playlists/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve({
                                            url, title: api.name, image: api.images[0],
                                            items: api.tracks.items.map(({ track }) => SpotifyLib.track(track))
                                        });
                                    } catch (e) {
                                        return reject(Error(`[APIs]: ${e}`))
                                    }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных треков артиста
                 */
                new class extends ItemRequestAPI {
                    public constructor() {
                        super({
                            name: "artist",
                            filter: /artist/i,
                            callback: (url: string) => {
                                const ID = SpotifyLib.getID(url);

                                return new Promise<Song[]>(async (resolve, reject) => {
                                    //Если ID автора не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID автора!"));

                                    try {
                                        //Создаем запрос
                                        const api = await SpotifyLib.API(`artists/${ID}/top-tracks?market=ES&limit=${env.get("APIs.limit.author")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve((api.tracks?.items ?? api.tracks).map(SpotifyLib.track));
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных по поиску
                 */
                new class extends ItemRequestAPI {
                    public constructor() {
                        super({
                            name: "search",
                            callback: (url: string) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await SpotifyLib.API(`search?q=${url}&type=track&limit=${env.get("APIs.limit.search")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve(api.tracks.items.map(SpotifyLib.track));
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                }
            ],
        });
    };
}

/**
 * @author SNIPPIK
 * @class SpotifyLib
 */
class SpotifyLib {
    private static authorization = {
        api: "https://api.spotify.com/v1",
        account: "https://accounts.spotify.com/api",
        aut: Buffer.from(env.get("token.spotify")).toString("base64"),
    }
    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    public static API = (method: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            const isLoggedIn = ldb.token !== undefined && ldb.time > Date.now() + 2;
            if (!isLoggedIn) await this.getToken();

            new httpsClient(`${this.authorization.api}/${method}`, {
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + ldb.token,
                    "accept-encoding": "gzip, deflate, br"
                }
            }).toJson.then((api) => {
                if (!api) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (api.error) return resolve(Error(`[APIs]: ${api.error.message}`));

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    }

    private static getToken = (): Promise<void> => {
        return new httpsClient(`${this.authorization.account}/token`, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Basic ${this.authorization.aut}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "accept-encoding": "gzip, deflate, br"
            },
            body: "grant_type=client_credentials",
            method: "POST"
        }).toJson.then((result) => {
            ldb.time = Date.now() + result["expires_in"];
            ldb.token = result["access_token"];
        });
    };

    /**
     * @description Получаем ID трека, плейлиста, альбома
     * @param url {string} Ссылка на трек, плейлист, альбом
     */
    public static getID(url: string): string {
        if (typeof url !== "string") return undefined;

        return url?.split('/')?.at(-1);
    }

    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     */
    public static track = (track: any): Song => {
        return new Song({
            title: track.name,
            url: track["external_urls"]["spotify"],
            author: {
                title: track["artists"][0].name,
                url: track["artists"][0]["external_urls"]["spotify"]
            },
            duration: { seconds: (track["duration_ms"] / 1000).toFixed(0) },
            image: track.album.images.sort((item1, item2) => item1.width > item2.width)[0],
        });
    }
}