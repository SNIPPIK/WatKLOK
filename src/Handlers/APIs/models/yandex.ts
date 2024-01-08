import {Song} from "@Client/Audio/Queue/Song";
import {httpsClient} from "@Client/Request";
import {API} from "@handler/APIs";
import crypto from "node:crypto";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @const db
 * @description Локальная база данных
 */
const db = {
    token: env.get("token.yandex"),

    api: "https://api.music.yandex.net",
    link: "https://music.yandex.ru"
};


/**
 * @author SNIPPIK
 * @class initYandex
 * @description Динамически загружаемый класс
 */
export default class implements API.load {
    public readonly name = "YANDEX";
    public readonly audio = true;
    public readonly auth = true;
    public readonly prefix = ["ym", "yandex", "y"];
    public readonly color = 16705372;
    public readonly filter = /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi;
    public readonly url = "music.yandex.ru"

    public readonly requests = [
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение трека
         * @type API.track
         */
        new class extends YandexLib implements API.track {
            public readonly type = "track";
            public readonly filter = /(album)?(track)/;

            public readonly callback = (url: string) => {
                const ID = url.split(/[^0-9]/g).filter(str => str !== "");

                return new Promise<Song>(async (resolve, reject) => {
                    try {
                        if (ID.length < 2) return reject(Error("[APIs]: Не найден ID трека!"));

                        //Делаем запрос
                        const api = await this._API(`tracks/${ID[1]}`);
                        const audio = await this._getAudio(ID[1]);

                        //Обрабатываем ошибки
                        if (api instanceof Error || audio instanceof Error) return reject(api);
                        else if (!api[0]) return reject(Error("[APIs]: Не удалось получить данные о треке!"));

                        api[0].author = await this._getAuthor(api[0]?.["artists"][0].id);
                        const track = this._track(api[0]);

                        if (audio) track.link = audio;
                        return resolve(track);
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
        new class extends YandexLib implements API.list {
            public readonly type = "album";
            public readonly filter = /album/;

            public readonly callback = (url: string) => {
                const ID = url.split(/[^0-9]/g).find(str => str !== "");

                return new Promise<Song.playlist>(async (resolve, reject) => {
                    //Если ID альбома не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

                    try {
                        //Создаем запрос
                        const api = await this._API(`albums/${ID}/with-tracks`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);
                        else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return reject(Error("[APIs]: Я не нахожу треков в этом альбоме!"));

                        const AlbumImage = this._parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                        const tracks: Song.track[] = api["volumes"]?.pop().splice(0, env.get("APIs.limit.playlist"));
                        const Author = await this._getAuthor(api["artists"][0]?.id);

                        const songs = tracks.map((track) => {
                            track.author = Author;
                            return this._track(track);
                        });

                        return resolve({url, title: api.title, image: AlbumImage, author: Author, items: songs});
                    } catch (e) {
                        return reject(Error(`[APIs]: ${e}`))
                    }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение плейлиста с треками
         * @type API.list
         */
        new class extends YandexLib implements API.list {
            public readonly type = "playlist";
            public readonly filter = /playlists/;

            public readonly callback = (url: string) => {
                const user = url.split("users/")[1].split("/")[0];
                const playlistID = url.split("playlists/")[1]?.split("/")[0];

                return new Promise<Song.playlist>(async (resolve, reject) => {
                    if (!user) return reject(Error("[APIs]: Не найден ID пользователя!"));
                    else if (!playlistID) return reject(Error("[APIs]: Не найден ID плейлиста!"));

                    try {
                        //Создаем запрос
                        const api = await this._API(`users/${user}/playlists/${playlistID}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);
                        else if (api.tracks.length === 0) return reject(Error("[APIs]: Я не нахожу треков в этом плейлисте!"));

                        const image = this._parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                        const tracks: any[] = api.tracks?.splice(0, env.get("APIs.limit.playlist"));
                        const songs = tracks.map(({track}) => this._track(track));

                        return resolve({
                            url, title: api.title, image: image, items: songs,
                            author: {
                                title: api.owner.name,
                                url: `https://music.yandex.ru/users/${user}`
                            }
                        });
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение треков
         * @type API.array
         */
        new class extends YandexLib implements API.array {
            public readonly type = "search";

            public readonly callback = (str: string) => {
                return new Promise<Song[]>(async (resolve, reject) => {
                    try {
                        //Создаем запрос
                        const api = await this._API(`search?type=all&text=${str.split(" ").join("%20")}&page=0&nococrrect=false`);

                        //Обрабатываем ошибки
                        if (api instanceof Error) return reject(api);
                        else if (!api.tracks) return reject(Error(`[APIs]: На Yandex music нет такого трека!`));

                        const tracks = api.tracks["results"].splice(0, env.get("APIs.limit.search")).map(this._track);
                        return resolve(tracks);
                    } catch (e) {
                        return reject(Error(`[APIs]: ${e}`))
                    }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение треков
         * @type API.array
         */
        new class extends YandexLib implements API.array {
            public readonly type = "artist";
            public readonly filter = /artist/;

            public readonly callback = (url: string) => {
                const ID = url.split(/[^0-9]/g).find(str => str !== "");

                return new Promise<Song[]>(async (resolve, reject) => {
                    //Если ID автора не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

                    try {
                        //Создаем запрос
                        const api = await this._API(`artists/${ID}/tracks`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);
                        const tracks = api.tracks.splice(0, env.get("APIs.limit.author"));

                        return resolve(tracks.map(this._track));
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        }
    ];
}


/**
 * @author SNIPPIK
 * @class YandexLib
 */
class YandexLib {
    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
    protected _API = (method: string): Promise<any> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient(`${db.api}/${method}`, {
                headers: { "Authorization": "OAuth " + db.token }, method: "GET"
            }).toJson.then((req) => {
                if (!req) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (!db.token) return resolve(Error("[APIs]: Не удалось залогиниться!"));
                else if (req?.error?.name === "session-expired") return resolve(Error("[APIs]: Токен не действителен!"));
                else if (req?.error?.name === "not-allowed") return resolve(Error("[APIs]: Токен не был допущен! Необходимо обновить!"));

                if (req?.result) return resolve(req?.result);
                return resolve(req);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };


    /**
     * @description Получаем исходный файл трека
     * @param ID {string} ID трека
     */
    protected _getAudio = (ID: string): Promise<string | Error> => {
        return new Promise<string | Error>(async (resolve) => {
            try {
                const api = await this._API(`tracks/${ID}/download-info`);

                if (!api || api instanceof Error) return resolve(Error("[APIs]: Невозможно получить исходный файл!"));
                else if (api.length === 0) return resolve(Error("[APIs]: Не удалось найти исходный файл музыки!"));

                const url = api.find((data: any) => data.codec !== "aac");

                if (!url) return resolve(Error("[APIs]: Не удалось найти исходный файл музыки!"));

                new httpsClient(url["downloadInfoUrl"]).toXML.then((xml) => {
                    if (xml instanceof Error) return resolve(xml);

                    const path = xml[1];
                    const sign = crypto.createHash("md5").update("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + xml[4]).digest("hex");

                    return resolve(`https://${xml[0]}/get-mp3/${sign}/${xml[2]}${path}`);
                }).catch((e) => resolve(Error(e)));
            } catch (e) { return resolve(Error(e)); }
        });
    };


    /**
     * @description Расшифровываем картинку
     * @param image {string} Ссылка на картинку
     * @param size {number} Размер картинки
     */
    protected _parseImage = ({image, size = 1e3}: { image: string, size?: number }): {url: string, width?: number, height?: number} => {
        if (!image) return { url: "" };

        return {
            url: `https://${image.split("%%")[0]}m${size}x${size}`,
            width: size, height: size
        };
    };


    /**
     * @description Получаем данные об авторе трека
     * @param ID {string} ID автора
     */
    protected _getAuthor = (ID: string): Promise<Song.author> => {
        return new Promise(async (resolve, reject) => {
            if (!ID) return resolve(null);

            try {
                //Создаем запрос
                const api = await this._API(`artists/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если мы получаем эту ошибку, то автора не существует
                if (api?.error && api?.error?.name === "unknown") return resolve(null);

                const author = api.artist;
                const image = this._parseImage({image: author?.["ogImage"]});

                return resolve({ url: `https://music.yandex.ru/artist/${ID}`, title: author.name, image: image });//, isVerified: true
            } catch (e) { return null }
        });
    }


    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек с Yandex Music
     */
    protected _track = (track: any): Song => {
        const author = track["artists"]?.length ? track["artists"]?.pop() : track["artists"];
        const album = track["albums"]?.length ? track["albums"][0] : track["albums"];

        return new Song({
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image: this._parseImage({image: track?.["ogImage"] || track?.["coverUri"]}) ?? null,
            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            duration: { seconds: (track["durationMs"] / 1000).toFixed(0) ?? "250" },

            author: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: this._parseImage({image: author?.["ogImage"] ?? author?.["coverUri"]}) ?? null
            }
        });
    }
}