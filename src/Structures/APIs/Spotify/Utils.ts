import {httpsClient} from "@httpsClient";
import {ISong} from "@AudioPlayer/Queue/Song";
import {env} from "@Fs";


//Локальная база данных
const db = {
    token: "",
    time: 0,

    api: "https://api.spotify.com/v1",
    link: "https://open.spotify.com",
    account: "https://accounts.spotify.com/api",
    aut: Buffer.from(env.get("SPOTIFY_ID") + ":" + env.get("SPOTIFY_SECRET")).toString("base64")
};

export namespace SpotifyUtils {
    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    export function API(method: string): Promise<SpotifyRes | Error> {
        return new Promise(async (resolve) => {
            const isLoggedIn = db.token !== undefined && db.time > Date.now() + 2;
            if (!isLoggedIn) await getToken();

            return new httpsClient(`${db.api}/${method}`, {
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
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ID трека, плейлиста, альбома
     * @param url {string} Ссылка на трек, плейлист, альбом
     */
    export function getID(url: string): string {
        if (typeof url !== "string") return undefined;

        return url?.split('/')?.at(-1);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об авторе или пользователе
     * @param url {string} ссылка на автора или пользователя
     * @param isUser {boolean} Это пользователь
     */
    export function getAuthor(url: string, isUser: boolean = false): Promise<ISong.author> {
        const ID = getID(url);

        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API(`${isUser ? "users" : "artists"}/${ID}`) as (SpotifyArtist | SpotifyUser) & FailResult;

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve({ // @ts-ignore
                    title: api?.name ?? api?.display_name, url,
                    image: api.images[0]
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    /**
     * @description Собираем трек в готовый образ
     * @param track {SpotifyTrack} Трек из Spotify API
     */
    export async function track(track: SpotifyTrack): Promise<ISong.track> {
        const sortImages = track.album.images[0].width > track.album.images.pop().width ? track.album.images[0] : track.album.images.pop();

        return {
            title: track.name,
            url: track.external_urls.spotify,
            author: (await Promise.all([getAuthor(track.artists[0].external_urls.spotify, track?.artists[0]?.type !== "artist")]))[0],
            duration: { seconds: (track.duration_ms / 1000).toFixed(0) },
            image: sortImages,
        }
    }
}

//====================== ====================== ====================== ======================
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
        db.time = Date.now() + result.expires_in;
        db.token = result.access_token;
    });
}





//====================== ====================== ====================== ======================

type SpotifyType = "track" | "playlist" | "album" | "artist" | "user";
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
    album_type: "single",
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
    album_type: "single",
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