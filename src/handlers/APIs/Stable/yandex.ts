import {Song} from "@lib/player/queue/Song";
import {httpsClient} from "@lib/request";
import {API, Constructor} from "@handler";
import crypto from "node:crypto";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
class YandexAPI extends Constructor.Assign<API.request> {
    public constructor() {
        super({
            name: "YANDEX",
            audio: true,
            auth: env.check("token.yandex"),

            color: 16705372,
            filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi,
            url: "music.yandex.ru",

            requests: [
                /**
                 * @description Запрос данных о треке
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /(album)\/[0-9]+\/(track)\/[0-9]+/gi,
                            callback: (url) => {
                                const ID = /track\/[0-9]+/gi.exec(url)?.pop()?.split("track")?.pop();

                                return new Promise<Song>(async (resolve, reject) => {
                                    try {
                                        if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                                        //Делаем запрос
                                        const api = await YandexLib.API(`tracks/${ID}`);
                                        const audio = await YandexLib.getAudio(ID);

                                        //Обрабатываем ошибки
                                        if (api instanceof Error || audio instanceof Error) return reject(api);
                                        else if (!api[0]) return reject(Error("[APIs]: Не удалось получить данные о треке!"));

                                        const track = YandexLib.track(api[0]);

                                        if (audio) track.link = audio;
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
                            filter: /(album)\/[0-9]+/,
                            callback: (url): any => {
                                const ID = /[0-9]+/.exec(url).pop();

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID альбома не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

                                    try {
                                        //Создаем запрос
                                        const api = await YandexLib.API(`albums/${ID}/with-tracks`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return reject(Error("[APIs]: Я не нахожу треков в этом альбоме!"));

                                        const AlbumImage = YandexLib.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                                        const tracks: Song.track[] = api["volumes"]?.pop().splice(0, env.get("APIs.limit.playlist"));
                                        const songs = tracks.map(YandexLib.track);

                                        return resolve({url, title: api.title, image: AlbumImage, items: songs});
                                    } catch (e) {
                                        return reject(Error(`[APIs]: ${e}`))
                                    }
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
                            filter: /(users\/[a-zA-Z0-9]+).*(playlists\/[0-9]+)/,
                            callback: (url) => {
                                const ID = /(users\/[a-zA-Z0-9]+).*(playlists\/[0-9]+)/.exec(url);

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    if (!ID[1]) return reject(Error("[APIs]: Не найден ID пользователя!"));
                                    else if (!ID[2]) return reject(Error("[APIs]: Не найден ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const api = await YandexLib.API(ID.at(0));

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        else if (api?.tracks?.length === 0) return reject(Error("[APIs]: Я не нахожу треков в этом плейлисте!"));

                                        const image = YandexLib.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                                        const tracks: any[] = api.tracks?.splice(0, env.get("APIs.limit.playlist"));
                                        const songs = tracks.map(({track}) => YandexLib.track(track));

                                        return resolve({
                                            url, title: api.title, image: image, items: songs,
                                            author: {
                                                title: api.owner.name,
                                                url: `https://music.yandex.ru/users/${ID[1]}`
                                            }
                                        });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
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
                            filter: /(artist)\/[0-9]+/,
                            callback: (url) => {
                                const ID = /[0-9]+/.exec(url);

                                return new Promise<Song[]>(async (resolve, reject) => {
                                    //Если ID автора не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

                                    try {
                                        //Создаем запрос
                                        const api = await YandexLib.API(`artists/${ID.pop()}/tracks`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        const tracks = api.tracks.splice(0, env.get("APIs.limit.author")).map(YandexLib.track);

                                        return resolve(tracks);
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
                            callback: (url ) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const api = await YandexLib.API(`search?type=all&text=${url.split(" ").join("%20")}&page=0&nococrrect=false`);

                                        //Обрабатываем ошибки
                                        if (api instanceof Error) return reject(api);
                                        else if (!api.tracks) return reject(Error(`[APIs]: На Yandex music нет такого трека!`));

                                        const tracks = api.tracks["results"].splice(0, env.get("APIs.limit.search")).map(YandexLib.track);
                                        return resolve(tracks);
                                    } catch (e) {
                                        return reject(Error(`[APIs]: ${e}`))
                                    }
                                });
                            }
                        });
                    };
                }
            ]
        });
    };
}

export default Object.values({YandexAPI});

/**
 * @author SNIPPIK
 * @class YandexLib
 */
class YandexLib {
    protected static authorization = {
        token: env.get("token.yandex"),
        api: "https://api.music.yandex.net"
    };

    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
    public static API = (method: string): Promise<any> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient(`${this.authorization.api}/${method}`, {
                headers: { "Authorization": "OAuth " + this.authorization.token }, method: "GET"
            }).toJson.then((req) => {
                if (!req || req instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (!this.authorization.token) return resolve(Error("[APIs]: Не удалось залогиниться!"));
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
    public static getAudio = (ID: string): Promise<string | Error> => {
        return new Promise<string | Error>(async (resolve) => {
            try {
                const api = await this.API(`tracks/${ID}/download-info`);

                if (!api) return resolve(Error("[APIs]: Невозможно получить исходный файл!"));
                else if (api instanceof Error) return resolve(api);
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
    public static parseImage = ({image, size = 1e3}: { image: string, size?: number }): {url: string, width?: number, height?: number} => {
        if (!image) return { url: "" };

        return {
            url: `https://${image.split("%%")[0]}m${size}x${size}`,
            width: size, height: size
        };
    };

    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек с Yandex Music
     */
    public static track = (track: any): Song => {
        const author = track["artists"]?.length ? track["artists"]?.pop() : track["artists"];
        const album = track["albums"]?.length ? track["albums"][0] : track["albums"];

        return new Song({
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image: this.parseImage({image: track?.["ogImage"] || track?.["coverUri"]}) ?? null,
            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            duration: { seconds: (track["durationMs"] / 1000).toFixed(0) ?? "250" },

            author: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: this.parseImage({image: author?.["ogImage"] ?? author?.["coverUri"]}) ?? null
            }
        });
    }
}