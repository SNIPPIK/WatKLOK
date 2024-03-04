import {Song} from "@watklok/player/queue/Song";
import {httpsClient} from "@watklok/request";
import {API, Constructor} from "@handler";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
class VkAPI extends Constructor.Assign<API.request> {
    public constructor() {
        super({
            name: "VK",
            audio: true,
            auth: env.check("token.vk"),

            color: 30719,
            filter: /^(https?:\/\/)?(vk\.com)\/.+$/gi,
            url: "vk.com",

            requests: [
                /**
                 * @description Запрос данных о треке
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /(audio)([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/i,
                            callback: (url) => {
                                const ID = /([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/i.exec(url);

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID трека не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const api = await VKLib.API("audio", "getById", `&audios=${ID.pop()}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);

                                        const track = VKLib.track(api.response.pop(), url);
                                        return resolve(track);
                                    } catch (e) {
                                        return reject(Error(`[APIs]: ${e}`))
                                    }
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
                            callback: (url) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const api = await VKLib.API("audio", "search", `&q=${url}`);

                                        //Если запрос выдал ошибку то
                                        if (api instanceof Error) return reject(api);
                                        const tracks = (api.response.items.splice(0, env.get("APIs.limit.search"))).map(VKLib.track);

                                        return resolve(tracks);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                }
            ]
        });
    };
}

export default Object.values({VkAPI});


/**
 * @author SNIPPIK
 * @class VKLib
 */
class VKLib {
    private static authorization = {
        api: "https://api.vk.com/method",
        token:`?access_token=${env.get("token.vk")}`
    };

    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     */
    public static API = (method: methodType, type: requestType, options: string): Promise<any | Error> => {
        return new Promise((resolve) => {
            const url = `${this.authorization.api}/${method}.${type}${this.authorization.token}${options}&v=5.131`;

            new httpsClient(url).toJson.then((api: any) => {
                if (!api || !api?.response) return resolve(Error("[APIs]: Невозможно найти данные!"));
                else if (api?.["error_code"] || api?.error) return resolve(Error(`[APIs]: ${api?.["error_msg"]}`));

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };


    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек из VK
     * @param url - Ссылка на трек
     */
    public static track = (track: any, url: string = null): Song => {
        const image = track?.album?.["thumb"];

        return new Song({
            url: url || `https://vk.com/audio${track["owner_id"]}_${track.id}`,
            title: track.title,
            author: this.author(track),
            image: { url: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined },
            duration: { seconds: track.duration.toFixed(0) },
            link: track?.url
        });
    };


    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     */
    public static author = (user: any): Song.author => {
        const url = `https://vk.com/audio?performer=1&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist }; //, isVerified: user.is_licensed
    };
}


type requestType = "get" | "getById" | "search" | "getPlaylistById" | "getPlaylist";
type methodType = "audio" | "execute" | "catalog";