import {Song} from "@Client/Audio/Queue/Song";
import {httpsClient} from "@Client/Request";
import {API} from "@handler/APIs";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @const db
 * @description Локальная база данных
 */
const db = {
    api: "https://api.vk.com/method",
    link: "https://vk.com",

    token: `?access_token=${env.get("token.vk")}`
};



/**
 * @author SNIPPIK
 * @class initVK
 * @description Динамически загружаемый класс
 */
export default class implements API.load {
    public readonly name = "VK";
    public readonly audio = true;
    public readonly auth = true;
    public readonly prefix = ["vk"];
    public readonly color = 30719;
    public readonly filter = /^(https?:\/\/)?(vk\.com)\/.+$/gi;
    public readonly url = "vk.com";
    public readonly requests = [
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение трека
         */
        new class extends VKLib implements API.track {
            public readonly type = "track";
            public readonly filter = /audio/;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song>(async (resolve, reject) => {
                    //Если ID трека не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                    try {
                        //Создаем запрос
                        const api = await this._API("audio", "getById", `&audios=${ID}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);

                        const track = this._track(api.response.pop());

                        return resolve(track);
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение треков
         */
        new class extends VKLib implements API.array {
            public readonly type = "search";

            public readonly callback = (search: string) => {
                return new Promise<Song[]>(async (resolve, reject) => {
                    try {
                        //Создаем запрос
                        const api = await this._API("audio", "search", `&q=${search}`);

                        //Если запрос выдал ошибку то
                        if (api instanceof Error) return reject(api);
                        const tracks = (api.response.items.splice(0, env.get("APIs.limit.search"))).map(this._track);

                        return resolve(tracks);
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        }
    ];
}



type requestType = "get" | "getById" | "search" | "getPlaylistById" | "getPlaylist";
type methodType = "audio" | "execute" | "catalog";
/**
 * @author SNIPPIK
 * @class VKLib
 */
class VKLib {
    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     */
    protected _API = (method: methodType, type: requestType, options: string): Promise<any | Error> => {
        return new Promise((resolve) => {
            const url = `${db.api}/${method}.${type}${db.token}${options}&v=5.131`;

            new httpsClient(url).toJson.then((api: any) => {
                if (!api || !api?.response) return resolve(Error("[APIs]: Невозможно найти данные!"));
                else if (api?.["error_code"] || api?.error) return resolve(Error(`[APIs]: ${api?.["error_msg"]}`));

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };


    /**
     * @description Получаем ID из ссылки
     * @param url {string} Ссылка
     */
    protected _getID = (url: string): string => {
        if (url.match(/\/audio/)) return url.split("/audio").at(- 1);
        return url.split("playlist/").at(- 1);
    };


    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек из VK
     */
    protected _track = (track: any): Song => {
        const image = track?.album?.["thumb"];

        return new Song({
            url: `${db.link}/audio${track["owner_id"]}_${track.id}`,
            title: track.title,
            author: this._author(track),
            image: { url: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined },
            duration: { seconds: track.duration.toFixed(0) },
            format: { url: track?.url }
        });
    };


    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     */
    protected _author = (user: any): Song.author => {
        const url = `${db.link}/audio&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist }; //, isVerified: user.is_licensed
    };
}