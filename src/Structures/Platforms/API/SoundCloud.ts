import {InputPlaylist, InputTrack} from "@Queue/Song";
import {httpsClient} from "@httpsClient";
import {env} from "@env";

const APiLink = "https://api-v2.soundcloud.com";
const clientID = env.get("SOUNDCLOUD");

namespace API {
    /**
     * @description Делаем запрос с привязкой ClientID
     * @param method {string} Ссылка
     */
    export function Request(method: string): Promise<{ result: any, ClientID: string }> {
        return new Promise(async (resolve) => {
            const ClientID = await getClientID();
            const result = await httpsClient.parseJson(`${APiLink}/${method}&client_id=${ClientID}`);

            return resolve({ result, ClientID });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проходим все этапы для получения ссылки на поток трека
     * @param formats {SoundCloudFormat[]} Зашифрованные форматы аудио
     * @param ClientID {string} ID клиента
     */
    export function getFormat(formats: SoundCloudFormat[], ClientID: string): Promise<string> {
        const filterFormats = formats.filter((d) => d.format.protocol === "progressive").pop() ?? formats[0];

        return new Promise(async (resolve) => {
            const EndFormat = await httpsClient.parseJson(`${filterFormats.url}?client_id=${ClientID}`);

            return resolve(EndFormat.url);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Если нет ClientID то получаем его как неавторизованный пользователь
     * @private
     */
    function getClientID(): Promise<string> | string {
        if (clientID) return clientID;

        return new Promise<string>(async (resolve) => {
            const parsedPage = await httpsClient.parseBody("https://soundcloud.com/", {
                options: { userAgent: true },
                request: {
                    headers: {
                        "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                        "accept-encoding": "gzip, deflate, br"
                    }
                }
            });

            if (!parsedPage) return resolve(null);

            const split = parsedPage.split("<script crossorigin src=\"");
            const urls: string[] = [];

            split.forEach((r) => r.startsWith("https") ? urls.push(r.split("\"")[0]) : null);

            const parsedPage2 = await httpsClient.parseBody(urls.pop());
            return resolve(parsedPage2.split(",client_id:\"")[1].split("\"")[0]);
        });
    }
}

namespace construct {
    export function track(track: any, url?: string): InputTrack {
        if (!track.user) return;

        return {
            url: url ?? track.permalink_url,
            title: track.title,
            author: author(track.user),
            image: parseImage(track.artwork_url),
            duration: { seconds: (track.duration / 1e3).toFixed(0) }
        };
    }
    export function author(user: any) {
        return {
            url: user.permalink_url,
            title: user.username,
            image: parseImage(user.avatar_url),
            isVerified: user.verified
        }
    }
    /**
     * @description Получаем картинку в исходном качестве
     * @param image {string} Ссылка на картинку
     * @constructor
     */
    export function parseImage(image: string): { url: string } {
        if (!image) return {url: image};

        const imageSplit = image.split("-");
        const FormatImage = image.split(".").pop();

        imageSplit[imageSplit.length - 1] = "original";

        return {url: `${imageSplit.join("-")}.${FormatImage}`};
    }
}

export namespace SoundCloud {
    /**
     * @description Получаем трек
     * @param url {string} Ссылка на трек
     */
    export function getTrack(url: string): Promise<InputTrack> {
        return new Promise(async (resolve, reject) => {
            try {
                const {result, ClientID} = await API.Request(`resolve?url=${url}`);

                if (!result?.id || !result) return resolve(null);
                const format = await API.getFormat(result.media.transcodings, ClientID);

                return resolve({...construct.track(result, url), format: {url: format}});
            } catch (e) { return reject(e) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем плейлист
     * @param url {string} Ссылка на плейлист
     */
    export function getPlaylist(url: string): Promise<InputTrack | InputPlaylist> {
        return new Promise(async (resolve, reject) => {
            try {
                const {result} = await API.Request(`resolve?url=${url}`);

                if (!result?.id || !result) return resolve(null);
                if (result.tracks === undefined) return getTrack(url).then(resolve);

                return resolve({
                    url,
                    title: result.title,
                    author: construct.author(result.user),
                    image: construct.parseImage(result.artwork_url),
                    items: result.tracks.map(construct.track)
                });
            } catch (e) { return reject(e) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки в soundcloud
     * @param search {string} Что ищем
     * @param options {limit: number} Кол-во выдаваемых треков
     * @constructor
     */
    export function SearchTracks(search: string, options = {limit: 15}): Promise<InputTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const {result} = await API.Request(`search/tracks?q=${search}&limit=${options.limit}`);

                if (!result) return resolve(null);

                return resolve(result.collection.map(construct.track));
            } catch (e) { return reject(e) }
        });
    }
}

interface SoundCloudFormat {
    url: string,
    preset: "mp3_0_0" | "opus_0_0",
    duration: number,
    snipped: boolean,
    format: {
        protocol: "hls" | "progressive",
        mime_type: "audio/mpeg"
    },
    quality: "sq"
}