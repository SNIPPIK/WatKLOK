import {httpsClient} from "../../../Core/httpsClient";
import {InputAuthor, InputPlaylist, InputTrack} from "../../../AudioPlayer/Structures/Queue/Song";
import {env} from "../../../Core/env";

const AccountUrl = "https://accounts.spotify.com/api"; //token
const ApiUrl = "https://api.spotify.com/v1"; //type/id/params
const SpotifyUrl = 'https://open.spotify.com';
const aut = env.get("SPOTIFY_ID") + ":" + env.get("SPOTIFY_SECRET");

const SpotifyRes = { token: "", time: 0 };

//Получаем ID трека, плейлиста, альбома
function getID(url: string): string {
    if (typeof url !== "string") return undefined;

    return new URL(url).pathname.split('/')[2];
}

//Интеграция с API SPOTIFY
namespace API {
    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    export async function Request(method: string): Promise<SpotifyRes> {
        const isLoggedIn = SpotifyRes.token !== undefined && SpotifyRes.time > Date.now() + 2;
        if (!isLoggedIn) await getToken();

        return httpsClient.parseJson(`${ApiUrl}/${method}`, {
            request: {
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + SpotifyRes.token,
                    "accept-encoding": "gzip, deflate, br"
                }
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем токен
     */
    function getToken(): Promise<void> {
        return httpsClient.parseJson(`${AccountUrl}/token`, {
            request: {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Authorization": `Basic ${Buffer.from(aut).toString("base64")}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "accept-encoding": "gzip, deflate, br"
                },
                body: "grant_type=client_credentials"
            }
        }).then((result) => {
            SpotifyRes.time = Date.now() + result.expires_in;
            SpotifyRes.token = result.access_token;
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Собираем трек в готовый образ
     * @param track {SpotifyTrack} Трек из Spotify API
     */
    export async function constructTrack(track: SpotifyTrack) {
        const sortImages = track.album.images[0].width > track.album.images.pop().width ? track.album.images[0] : track.album.images.pop();

        return {
            title: track.name,
            url: track.external_urls.spotify,
            author: (await Promise.all([Spotify.getAuthorTrack(track.artists[0].external_urls.spotify, track?.artists[0]?.type !== "artist")]))[0],
            duration: { seconds: (track.duration_ms / 1000).toFixed(0) },
            image: sortImages,
        }
    }
}

export namespace Spotify {
    /**
     * @description Получаем данные о треке
     * @param url {string} Ссылка на трек
     */
    export function getTrack(url: string): Promise<InputTrack | null> {
        const id = getID(url);

        return new Promise(async (resolve, reject) => {
            const result = await API.Request(`tracks/${id}`) as SpotifyTrack & FailResult;

            if (!result || !result?.name) return resolve(null);
            if (result.error) throw reject(new Error(result.error.message));

            return resolve(API.constructTrack(result));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description получаем данные о плейлисте + треки
     * @param url {string} Ссылка на плейлист
     * @param options {limit: number} Настройки
     */
    export function getPlaylist(url: string, options: { limit: number } = {limit: 50}): Promise<InputPlaylist | null> {
        const id = getID(url);

        return new Promise(async (resolve, reject) => {
            const result = await API.Request(`playlists/${id}?offset=0&limit=${options.limit}`) as SpotifyPlaylist & FailResult;

            if (!result || !result?.name) return resolve(null);
            if (result.error) throw reject(new Error(result.error.message));

            return resolve({
                url, title: result.name, image: result.images[0],
                items: await Promise.all(result.tracks.items.map(({track}) => API.constructTrack(track))),
                author: (await Promise.all([getAuthorTrack(`${SpotifyUrl}/artist/${result.owner.id}`, result?.owner?.type !== "artist")]))[0]
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные на альбом + треки
     * @param url {string} Ссылка на альбом
     * @param options {limit: number} Настройки
     */
    export function getAlbum(url: string, options: { limit: number } = {limit: 50}): Promise<InputPlaylist | null> {
        const id = getID(url);

        return new Promise(async (resolve, reject) => {
            const result = await API.Request(`albums/${id}?offset=0&limit=${options.limit}`) as SpotifyAlbumFull & FailResult;

            if (!result || !result?.name) return resolve(null);
            if (result.error) throw reject(new Error(result.error.message));

            return resolve({
                url, title: result.name, image: result.images[0],
                items: await Promise.all(result.tracks.items.map(API.constructTrack)),
                author: (await Promise.all([getAuthorTrack(`${SpotifyUrl}/artist/${result?.artists[0].id}`, result?.artists[0]?.type !== "artist")]))[0]
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки в базах spotify
     * @param search {string} Что ищем
     * @param options {limit: number} Настройки поиска
     */
    export function SearchTracks(search: string, options: { limit: number } = {limit: 15}): Promise<InputTrack[] | null> {
        return new Promise(async (resolve, reject) => {
            const result = await API.Request(`search?q=${search}&type=track&limit=${options.limit}`) as SearchTracks & FailResult;

            if (!result) return resolve(null);
            if (result.error) throw reject(new Error(result.error.message));

            return resolve(await Promise.all(result.tracks.items.map(API.constructTrack)));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об авторе или пользователе
     * @param url {string} ссылка на автора или пользователя
     * @param isUser {boolean} Это пользователь
     */
    export function getAuthorTrack(url: string, isUser: boolean = false): Promise<InputAuthor> {
        const id = getID(url);

        return new Promise(async (resolve, reject) => {
            const result = await API.Request(`${isUser ? "users" : "artists"}/${id}`) as (SpotifyArtist | SpotifyUser) & FailResult;

            if (!result) return resolve(null);
            if (result.error) throw reject(new Error(result.error.message));

            return resolve({ // @ts-ignore
                title: result?.name ?? result?.display_name, url,
                image: result.images[0],
                isVerified: result.followers.total >= 500
            });
        });
    }
}
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================

type SpotifyType = "track" | "playlist" | "album" | "artist" | "user";
type AlbumType = "single";
type SpotifyRes = (SpotifyPlaylist | SpotifyTrack | SpotifyArtist | SpotifyUser | SpotifyAlbumFull | SearchTracks) & FailResult;

interface FailResult {
    error: {
        status: number,
        message: string
    }
}

/*   interface global   */
interface SpotifyTrack {
    album: SpotifyAlbum,
    artists: SpotifyArtist[],
    available_markets: string[],
    disc_number: number,
    duration_ms: number,
    episode: boolean,
    explicit: boolean,
    external_ids: { isrc: string },
    external_urls: { spotify: string },
    href: string,
    id: string,
    is_local: boolean,
    name: string,
    popularity: number,
    preview_url: string,
    track: boolean,
    track_number: number,
    type: SpotifyType,
    uri: string
}

interface AlbumImage {
    height: number,
    url: string,
    width: number
}

/*   interface Playlist    */
interface SpotifyPlaylist {
    collaborative: boolean,
    description: string,
    external_urls: {
        spotify: string
    },
    followers: { href: null, total: number },
    href: string,
    id: string,
    images: AlbumImage[],
    name: string,
    owner: {
        display_name: string,
        external_urls: {
            spotify: string
        },
        href: string,
        id: string,
        type: SpotifyType,
        uri: string
    },
    primary_color: null,
    public: boolean,
    snapshot_id: string,
    tracks: {
        href: string,
        items: {
            track: SpotifyTrack
        }[],
        limit: number,
        next: null,
        offset: number,
        previous: null,
        total: number
    },
    type: SpotifyType,
    uri: string
}

/*   interface Album    */
interface SpotifyAlbumFull {
    album_type: AlbumType,
    artists: SpotifyArtist[],
    available_markets: string[],
    copyrights: [
        {
            text: string,
            type: string
        }
    ],
    external_ids: {
        upc: string
    },
    external_urls: {
        spotify: string
    },
    genres: [],
    href: string,
    id: string,
    images: AlbumImage[],
    label: string,
    name: string,
    popularity: number,
    release_date: string,
    release_date_precision: string,
    total_tracks: number,
    tracks: {
        href: string,
        items: SpotifyTrack[],
        limit: number,
        next: null,
        offset: number,
        previous: null,
        total: number
    },
    type: SpotifyType,
    uri: string

}

interface SpotifyAlbum {
    album_type: AlbumType,
    artists: SpotifyArtist[],
    available_markets: string[],
    external_urls: {
        spotify: string
    },
    href: string,
    id: string,
    images: AlbumImage[],
    name: string,
    release_date: Date,
    release_date_precision: string,
    total_tracks: number,
    type: SpotifyType,
    uri: string
}

/*   interface SearchTracks   */
interface SearchTracks {
    tracks: {
        href: string,
        items: SpotifyTrack[]
        limit: number,
        next: string,
        offset: number,
        previous: null,
        total: number
    }
}

/*   interface Artist   */
interface SpotifyArtist {
    external_urls: {
        spotify: string
    },
    followers: {
        href: null,
        total: number
    },
    genres: string[],
    href: string,
    id: string,
    images: AlbumImage[],
    name: string,
    popularity: number,
    type: SpotifyType,
    uri: string
}

interface SpotifyUser {
    display_name: string,
    external_urls: {
        spotify: string
    },
    followers: {
        href: null,
        total: number
    },
    href: string,
    id: string,
    images: AlbumImage[],
    type: SpotifyType,
    uri: string
}
