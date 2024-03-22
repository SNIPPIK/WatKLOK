import {Song} from "@lib/player/queue/Song";
import {httpsClient} from "@lib/request";
import {API, Constructor} from "@handler";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @API Spotify
 */
class currentAPI extends Constructor.Assign<API.request> {
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
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /track\/[0-9z]+/i,
                            callback: (url: string) => {
                                const ID = /track\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("track\/")?.pop();

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID трека не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const api = await currentAPI.API(`tracks/${ID}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        const track = currentAPI.track(api)

                                        return resolve(track);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных об альбоме
                 */
                new class extends API.item<"album"> {
                    public constructor() {
                        super({
                            name: "album",
                            filter: /album\/[0-9z]+/i,
                            callback: (url: string) => {
                                const ID = /album\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("album\/")?.pop();

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID альбома не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID альбома!"));

                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await currentAPI.API(`albums/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        const tracks = api.tracks.items.map(currentAPI.track)

                                        return resolve({ url, title: api.name, image: api.images[0], items: tracks, author: api?.["artists"][0] });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных об плейлисте
                 */
                new class extends API.item<"playlist"> {
                    public constructor() {
                        super({
                            name: "playlist",
                            filter: /playlist\/[0-9z]+/i,
                            callback: (url: string) => {
                                const ID = /playlist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("playlist\/")?.pop();

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await currentAPI.API(`playlists/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        const tracks = api.tracks.items.map(({ track }) => currentAPI.track(track));

                                        return resolve({ url, title: api.name, image: api.images[0], items: tracks });
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
                new class extends API.item<"artist"> {
                    public constructor() {
                        super({
                            name: "artist",
                            filter: /artist\/[0-9z]+/i,
                            callback: (url: string) => {
                                const ID = /artist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("artist\/")?.pop();

                                return new Promise<Song[]>(async (resolve, reject) => {
                                    //Если ID автора не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID автора!"));

                                    try {
                                        //Создаем запрос
                                        const api = await currentAPI.API(`artists/${ID}/top-tracks?market=ES&limit=${env.get("APIs.limit.author")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve((api.tracks?.items ?? api.tracks).map(currentAPI.track));
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных по поиску
                 */
                new class extends API.item<"search"> {
                    public constructor() {
                        super({
                            name: "search",
                            callback: (url: string) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const api: Error | any = await currentAPI.API(`search?q=${url}&type=track&limit=${env.get("APIs.limit.search")}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        return resolve(api.tracks.items.map(currentAPI.track));
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                }
            ]
        });
    };

    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        link: "https://open.spotify.com",
        api: "https://api.spotify.com/v1",
        account: "https://accounts.spotify.com/api",
        aut: Buffer.from(env.get("token.spotify")).toString("base64"),

        token: "",
        time:0
    };

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    protected static API = (method: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            try {
                //Нужно обновить токен
                if (!(this.authorization.token !== undefined && this.authorization.time > Date.now() + 2)) {
                    const token = await new httpsClient(`${this.authorization.account}/token`, {
                        headers: {
                            "Accept": "application/json",
                            "Authorization": `Basic ${this.authorization.aut}`,
                            "Content-Type": "application/x-www-form-urlencoded",
                            "accept-encoding": "gzip, deflate, br"
                        },
                        body: "grant_type=client_credentials",
                        method: "POST"
                    }).toJson;

                    if (token instanceof Error) return resolve(token);

                    this.authorization.time = Date.now() + token["expires_in"];
                    this.authorization.token = token["access_token"];
                }
            } finally {
                new httpsClient(`${this.authorization.api}/${method}`, {
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": "Bearer " + this.authorization.token,
                        "accept-encoding": "gzip, deflate, br"
                    }
                }).toJson.then((api) => {
                    if (!api) return resolve(Error("[APIs]: Не удалось получить данные!"));
                    else if (api.error) return resolve(Error(`[APIs]: ${api.error.message}`));

                    return resolve(api);
                }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
            }
        });
    };

    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     */
    protected static track = (track: any): Song => {
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

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({currentAPI});