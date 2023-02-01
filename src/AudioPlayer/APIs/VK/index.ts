import {InputPlaylist, InputTrack} from "@Queue/Song";
import {httpsClient} from "@httpsClient";
import {env} from "@env";

const vkApiLink = "https://api.vk.com/method/";
const connectString = `?access_token=${env.get("VK_TOKEN")}`;

type requestType = "get" | "getById" | "search" | "getPlaylistById" | "getPlaylist";
type methodType = "audio" | "execute" | "catalog";

//Получаем ID
function getID(url: string): string {
    if (url.match(/\/audio/)) return url.split("/audio")[1];
    return url.split("playlist/")[1];
}

//====================== ====================== ====================== ======================
/**
 * Простая реализация API VK
 * Необходим токен пользователя, если использовать токен бота то вк не даст доступ к трекам
 * Проверены токены из офф приложения vk, vk admins (токены из kate mobile не работают)
 */
//====================== ====================== ====================== ======================

/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     */
    export function Request(method: methodType, type: requestType, options: string): Promise<any | Error> {
        return new Promise(async (resolve) => {
            const url = `${vkApiLink}${method}.${type}${connectString}${options}&v=5.131`;
            const api = await httpsClient.parseJson(url, { request: {headers: {"accept-encoding": "gzip, deflate, br"}}});

            if (!api || !api?.response) return resolve(Error("[APIs]: Невозможно найти данные!"));
            else if (api?.error) return resolve(Error(`[APIs]: ${api.error_msg}`));
            else if (api?.error_code) return resolve(Error(`[APIs]: ${api?.error_msg}`));

            return resolve(api);
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Формирование общих данных
 */
namespace construct {
    export function track(track: Track["response"][0]) {
        const image = track?.album?.thumb;

        return {
            url: `https://vk.com/audio${track.owner_id}_${track.id}`,
            title: track.title,
            author: author(track),
            image: {url: image?.photo_1200 ?? image?.photo_600 ?? image?.photo_300 ?? image?.photo_270 ?? undefined},
            duration: { seconds: track.duration.toFixed(0) },
            format: { url: track?.url }
        };
    }
    export function author(user: any) {
        const url = `https://vk.com/audio&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist, isVerified: user.is_licensed };
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Какие запросы доступны (какие были добавлены)
 */
export namespace VK {
    export function getTrack(url: string): Promise<InputTrack> {
        const ID = getID(url);

        return new Promise(async (resolve, reject) => {
            //Если ID трека не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

            try {
                //Создаем запрос
                const api = await API.Request("audio", "getById", `&audios=${ID}`) as Track & rateLimit;

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve(construct.track(api.response.pop()));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Делаем запрос к VK API (через account), получаем данные о плейлисте
     * @param url {string} Ссылка
     * @param options {{limit: number}}
     */
    export function getPlaylist(url: string, options = {limit: 20}): Promise<InputPlaylist> {
        const PlaylistFullID = getID(url).split("_");
        const playlist_id = PlaylistFullID[1];
        const owner_id = PlaylistFullID[0];
        const key = PlaylistFullID[2];

        return new Promise(async (resolve, reject) => {
            //Если ID не полный
            if (PlaylistFullID.length < 3) return reject(Error("[APIs]: ID плейлиста не полный!"));

            try {
                //Создаем запрос и получаем треки из этого плейлиста
                const api = await API.Request("audio", "getPlaylistById", `&owner_id=${owner_id}&playlist_id=${playlist_id}&access_key=${key}`) as Playlist & rateLimit;
                const items = await API.Request("audio", "get", `&owner_id=${owner_id}&album_id=${playlist_id}&count=${options.limit}&access_key=${key}`) as SearchTracks;

                //Если запрос выдал ошибку то
                if (api instanceof Error || items instanceof Error) return reject(api);

                const playlist = api.response;
                const image = playlist?.thumbs?.length > 0 ? playlist?.thumbs[0] : null;

                return resolve({
                    url, title: playlist.title,
                    items: items.response.items.map(construct.track),
                    image: {url: image?.photo_1200 ?? image?.photo_600 ?? image?.photo_300 ?? image?.photo_270 ?? undefined}
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Делаем запрос к VK API (через account), получаем данные о поиске
     * @param search {string} Что ищем
     * @param options {{limit: number}}
     */
    export function SearchTracks(search: string, options: { limit: number } = {limit: 15}): Promise<null | InputTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request("audio", "search", `&q=${search}`) as SearchTracks & rateLimit;

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const trackConst = api.response.items.length;
                if (trackConst > options.limit) api.response.items.splice(options.limit - 1, trackConst - options.limit - 1);

                return resolve(api.response.items.map(construct.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}

//====================== ====================== ====================== ======================
interface SearchTracks {
    response: {
        count: number,
        items: Track["response"][0][]
    }
}

interface Playlist {
    response: {
        id: number,
        owner_id: number,
        type: number,
        title: string,
        description: string,
        count: number,
        followers: number,
        plays: number,
        create_time: number,
        update_time: number,
        genres: [],
        is_following: boolean,
        thumbs: Images[],
        access_key: string,
        album_type: string
    }
}

interface Track {
    response:
        [
            {
                artist: string,
                id: number,
                owner_id: number,
                title: string,
                duration: number,
                access_key: string,
                ads: {
                    content_id: string,
                    duration: string,
                    account_age_type: string,
                    puid22: string
                },
                is_explicit: boolean,
                is_licensed: boolean,
                track_code: string,
                url: string,
                date: number,
                no_search: number,
                is_hq: boolean,
                album: {
                    id: number,
                    title: string,
                    owner_id: number,
                    access_key: string,
                    thumb: Images
                },
                main_artists: [
                    {
                        name: string,
                        domain: string,
                        id: string
                    }
                ],
                featured_artists: [
                    {
                        name: string,
                        domain: string,
                        id: string
                    }
                ],
                short_videos_allowed: boolean,
                stories_allowed: boolean,
                stories_cover_allowed: boolean
            }
        ]
}

interface Images {
    width: number,
    height: number,
    photo_34: string,
    photo_68: string,
    photo_135: string,
    photo_270: string,
    photo_300: string,
    photo_600: string,
    photo_1200: string
}

interface rateLimit {
    error: {
        error_code: number,
        error_msg: string,
        request_params: any[]
    }
}