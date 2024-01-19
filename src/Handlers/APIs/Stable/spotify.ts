import {Song} from "@Client/Audio/Queue/Song";
import {httpsClient} from "@Client/Request";
import {API} from "@handler";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @const db
 * @description Локальная база данных
 */
const db = {
    token: "",
    time: 0,

    api: "https://api.spotify.com/v1",
    link: "https://open.spotify.com",
    account: "https://accounts.spotify.com/api",
    aut: Buffer.from(env.get("token.spotify")).toString("base64")
};


/**
 * @author SNIPPIK
 * @class initSpotify
 * @description Динамически загружаемый класс
 */
export default class implements API.load {
    public readonly name = "SPOTIFY";
    public readonly audio = false;
    public readonly auth = true;
    public readonly prefix = ["sp"];
    public readonly color = 1420288;
    public readonly filter = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
    public readonly url = "open.spotify.com";
    public readonly requests = [
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение трека
         * @type API.track
         */
        new class extends SpotifyLib implements API.track {
            public readonly type = "track";
            public readonly filter = /track/;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song>(async (resolve, reject) => {
                    //Если ID трека не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                    try {
                        //Создаем запрос
                        const api = await this._API(`tracks/${ID}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        return resolve(this._track(api));
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение альбома с треками
         * @type API.list
         */
        new class extends SpotifyLib implements API.list {
            public readonly type = "album";
            public readonly filter = /album/;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song.playlist>(async (resolve, reject) => {
                    //Если ID альбома не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не найден ID альбома!"));

                    try {
                        //Создаем запрос
                        const api: Error | any = await this._API(`albums/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        return resolve({
                            url, title: api.name, image: api.images[0],
                            items: await Promise.all(api.tracks.items.map(this._track)),
                            author: (await Promise.all([this._getAuthor(`https://open.spotify.com/artist/${api?.["artists"][0].id}`, api?.["artists"][0]?.type !== "artist")]))[0]
                        });
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение плейлиста с треками
         * @type API.list
         */
        new class extends SpotifyLib implements API.list {
            public readonly type = "playlist";
            public readonly filter = /playlist/;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song.playlist>(async (resolve, reject) => {
                    //Если ID плейлиста не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не найден ID плейлиста!"));

                    try {
                        //Создаем запрос
                        const api: Error | any = await this._API(`playlists/${ID}?offset=0&limit=${env.get("APIs.limit.playlist")}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        return resolve({
                            url, title: api.name, image: api.images[0],
                            // @ts-ignore
                            items: await Promise.all(api.tracks.items.map(({ track }) => this._track(track))),
                            author: (await Promise.all([this._getAuthor(`https://open.spotify.com/artist/${api.owner.id}`, api?.owner?.type !== "artist")]))[0]
                        });
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение треков по поиску
         * @type API.array
         */
        new class extends SpotifyLib implements API.array {
            public readonly type = "search";

            public readonly callback = (search: string) => {
                return new Promise<Song[]>(async (resolve, reject) => {
                    try {
                        //Создаем запрос
                        const api: Error | any = await this._API(`search?q=${search}&type=track&limit=${env.get("APIs.limit.search")}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        return resolve(await Promise.all(api.tracks.items.map(this._track)));
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение треков автора
         * @type API.array
         */
        new class extends SpotifyLib implements API.array {
            public readonly type = "artist";
            public readonly filter = /artist/;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song[]>(async (resolve, reject) => {
                    //Если ID автора не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не найден ID автора!"));

                    try {
                        //Создаем запрос
                        const api = await this._API(`artists/${ID}/top-tracks?market=ES&limit=${env.get("APIs.limit.author")}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        // @ts-ignore
                        return resolve(await Promise.all((api.tracks?.items ?? api.tracks).map(this._track)));
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        }
    ];
}


/**
 * @author SNIPPIK
 * @class SpotifyLib
 */
class SpotifyLib {
    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    protected _API = (method: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            const isLoggedIn = db.token !== undefined && db.time > Date.now() + 2;
            if (!isLoggedIn) await getToken();

            new httpsClient(`${db.api}/${method}`, {
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + db.token,
                    "accept-encoding": "gzip, deflate, br"
                }
            }).toJson.then((api) => {
                if (!api) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (api.error) return resolve(Error(`[APIs]: ${api.error.message}`));

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    }


    /**
     * @description Получаем ID трека, плейлиста, альбома
     * @param url {string} Ссылка на трек, плейлист, альбом
     */
    protected _getID(url: string): string {
        if (typeof url !== "string") return undefined;

        return url?.split('/')?.at(-1);
    }


    /**
     * @description Получаем данные об авторе или пользователе
     * @param url {string} ссылка на автора или пользователя
     * @param isUser {boolean} Это пользователь
     */
    protected _getAuthor(url: string, isUser: boolean = false): Promise<Song.author> {
        const ID = this._getID(url);

        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await this._API(`${isUser ? "users" : "artists"}/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve({ // @ts-ignore
                    title: api?.name ?? api?.["display_name"], url,
                    image: api.images[0]
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }


    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     */
    protected _track = async (track: any): Promise<Song> => {
        const sortImages = track.album.images[0].width > track.album.images.pop().width ? track.album.images[0] : track.album.images.pop();

        return new Song({
            title: track.name,
            url: track["external_urls"]["spotify"],
            author: (await Promise.all([this._getAuthor(track["artists"][0]["external_urls"]["spotify"], track?.["artists"][0]?.type !== "artist")]))[0],
            duration: { seconds: (track["duration_ms"] / 1000).toFixed(0) },
            image: sortImages,
        });
    }
}


/**
 * @description Получаем токен
 */
function getToken(): Promise<void> {
    return new httpsClient(`${db.account}/token`, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Basic ${db.aut}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "accept-encoding": "gzip, deflate, br"
        },
        body: "grant_type=client_credentials",
        method: "POST"
    }).toJson.then((result) => {
        db.time = Date.now() + result["expires_in"];
        db.token = result["access_token"];
    });
}