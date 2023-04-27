import {env} from "@env";
import {httpsClient} from "@httpsClient";
import {ISong} from "@AudioPlayer/Structures/Song";

//Локальная база данных
const db = {
    api: "https://api.vk.com/method",
    link: "https://vk.com",

    token: `?access_token=${env.get("VK_TOKEN")}`
};
//====================== ====================== ====================== ======================
/**
 * @description Система запросов
 */
export namespace VkUtils {
    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     */
    export function API(method: methodType, type: requestType, options: string): Promise<any | Error> {
        return new Promise(async (resolve) => {
            const url = `${db.api}/${method}.${type}${db.token}${options}&v=5.131`;
            const api = await new httpsClient(url).toJson;

            if (!api || !api?.response) return resolve(Error("[APIs]: Невозможно найти данные!"));
            else if (api?.error) return resolve(Error(`[APIs]: ${api.error_msg}`));
            else if (api?.error_code) return resolve(Error(`[APIs]: ${api?.error_msg}`));

            return resolve(api);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ID из ссылки
     * @param url {string} Ссылка
     */
    export function getID(url: string): string {
        if (url.match(/\/audio/)) return url.split("/audio").at(- 1);
        return url.split("playlist/").at(- 1);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек из VK
     */
    export function track(track: any): ISong.track {
        const image = track?.album?.thumb;

        return {
            url: `${db.link}/audio${track.owner_id}_${track.id}`,
            title: track.title,
            author: author(track),
            image: { url: image?.photo_1200 ?? image?.photo_600 ?? image?.photo_300 ?? image?.photo_270 ?? undefined },
            duration: { seconds: track.duration.toFixed(0) },
            format: { url: track?.url }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     */
    export function author(user: any): ISong.author {
        const url = `${db.link}/audio&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist }; //, isVerified: user.is_licensed
    }
}

type requestType = "get" | "getById" | "search" | "getPlaylistById" | "getPlaylist";
type methodType = "audio" | "execute" | "catalog";