import { extractSignature, YouTubeFormat } from "./Decipher";
import { ISong } from "@Queue/Song";
import { httpsClient } from "@httpsClient";
import { APIs } from "@db/Config.json";

//====================== ====================== ====================== ======================
/**
 * Простой парсер youtube
 * Некоторое взято у ytdl-core (Decipher или extractorSignature)
 */
//====================== ====================== ====================== ======================

//Локальная база данных
const db = {
    link: "https://www.youtube.com"
};
//====================== ====================== ====================== ======================
/**
 * @description Формирование общих данных
 */
namespace construct {
    /**
     * @description Из полученных данных заготовляваем трек для AudioPlayer<Queue>
     * @param video {any} Любое видео с youtube
     */
    export async function video(video: any): Promise<ISong.track> {
        return {
            url: `https://youtu.be/${video.videoId}`,
            title: video.title,
            duration: { seconds: video.lengthSeconds },
            image: video.thumbnail.thumbnails.pop(),
            author: await getChannel({ id: video.channelId, name: video.author }),
            isLive: video.isLiveContent
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из полученных данных заготовляваем трек для inPlaylist
     * @param video {any} Любое видео с youtube
     * @returns 
     */
    export function playlist(video: any): ISong.track {
        return {
            url: `${db.link}/watch?v=${video.videoId}`,
            title: video.title.runs[0].text,
            author: {
                title: video.shortBylineText.runs[0].text || undefined,
                url: `${db.link}${video.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || video.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`
            },
            duration: { seconds: video.lengthSeconds ?? video.lengthText?.simpleText ?? 0 },
            image: {
                url: video.thumbnail.thumbnails.pop().url,
                height: video.thumbnail.thumbnails.pop()?.height,
                width: video.thumbnail.thumbnails.pop()?.width
            },
            isLive: video?.isLive || video?.is_live
        };
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Какие запросы доступны (какие были добавлены)
 */
export namespace YouTube {
    /**
     * @description Получаем данные о видео
     * @param url {string} Ссылка на видео
     */
    export function getVideo(url: string): Promise<ISong.track> {
        const ID = getID(url);

        return new Promise(async (resolve, reject) => {
            //Если ID видео не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

            try {
                //Создаем запрос
                const page = await httpsClient.get(`${db.link}/watch?v=${ID}&has_verified=1`, {
                    resolve: "string", cookie: true, useragent: true,
                    headers: {
                        "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                        "accept-encoding": "gzip, deflate, br"
                    }
                }) as string | Error;

                if (page instanceof Error) return reject(Error("[APIs]: Не удалось получить данные!"));

                const result = JSON.parse(page?.split("var ytInitialPlayerResponse = ")?.[1]?.split(";</script>")[0]?.split(/(?<=}}});\s*(var|const|let)\s/)[0]);

                //Если нет данных на странице
                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));

                //Если статус получения данные не OK
                if (result.playabilityStatus?.status === "LOGIN_REQUIRED") return reject(Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`));
                else if (result.playabilityStatus?.status !== "OK") return reject(Error(`[APIs]: Не удалось получить данные! Status: ${result?.playabilityStatus?.status}`));

                const details = result.videoDetails;
                let audios: YouTubeFormat;

                //Выбираем какой формат у видео из <VideoDetails>.isLiveContent
                if (details.isLiveContent) audios = { url: details.streamingData?.dashManifestUrl ?? null }; //dashManifestUrl, hlsManifestUrl
                else {
                    const html5player = `${db.link}${page.split('"jsUrl":"')[1].split('"')[0]}`;
                    const format = await extractSignature([...result.streamingData?.formats ?? [], ...result.streamingData?.adaptiveFormats ?? []], html5player);

                    //Если формат ну удалось получить из-за ошибки
                    if (format instanceof Error) return reject(format);

                    audios = format;
                }

                return resolve({ ...await construct.video(details), format: audios });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о плейлисте
     * @param url {string} Ссылка на плейлист
     */
    export function getPlaylist(url: string, options = { limit: APIs.limits.playlist }): Promise<ISong.playlist> {
        const ID = getID(url, true);

        return new Promise(async (resolve, reject) => {
            //Если ID плейлиста не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

            try {
                //Создаем запрос
                const page = await httpsClient.get(`${db.link}/playlist?list=${ID}`, {
                    resolve: "string", cookie: true, useragent: true,
                    headers: {
                        "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                        "accept-encoding": "gzip, deflate, br"
                    }
                }) as string | Error;

                if (page instanceof Error) return reject(Error("[APIs]: Не удалось получить данные!"));

                const result = page.split('var ytInitialData = ')[1].split(';</script>')[0].split(/;\s*(var|const|let)\s/)[0];

                //Если нет данных на странице
                if (!result) return reject(new Error("[APIs]: Не удалось получить данные!"));

                const jsonResult = JSON.parse(result);
                const info = jsonResult.sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer;
                const author = jsonResult.sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer;
                const videos: any[] = jsonResult.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0]
                    .itemSectionRenderer.contents[0].playlistVideoListRenderer.contents.splice(0, options.limit);

                return resolve({
                    title: info.title.runs[0].text, url,
                    items: videos.map(({ playlistVideoRenderer }) => construct.playlist(playlistVideoRenderer)),
                    author: await getChannel({ id: author.navigationEndpoint.browseEndpoint.browseId, name: author.title.runs[0].text }),
                    image: info.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails.pop()
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
    * @description Поиск видео на youtube
    * @param search {string} что ищем
    * @param options {limit} Настройки
    */
    export function SearchVideos(search: string, options = { limit: APIs.limits.search }): Promise<ISong.track[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const page = await httpsClient.get(`${db.link}/results?search_query=${search.split(" ").join("+")}`, {
                    resolve: "string", cookie: true, useragent: true,
                    headers: {
                        "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                        "accept-encoding": "gzip, deflate, br"
                    }
                }) as string | Error;

                if (page instanceof Error) return reject(Error("[APIs]: Не удалось получить данные!"));

                const result = (page.split("var ytInitialData = ")[1].split("}};")[0] + '}}').split(';</script><script')[0];

                //Если нет данных на странице
                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(result)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;

                //Если нет данных на странице (если нет результатов поиска)
                if (!details) return reject(Error(`[APIs]: Не удалось найти: ${search}`));
                const videos = details?.filter((video: any) => video && video?.videoRenderer && video?.videoRenderer?.videoId)?.splice(0, options.limit);

                if (videos.length < 1) return reject(Error(`[APIs]: Не удалось найти: ${search}`));

                return resolve(videos.map(({ videoRenderer }: any) => construct.playlist(videoRenderer)));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем 5 последних треков автора
     * @param url {string} Ссылка на автора
     */
    export function getChannelVideos(url: string, options = { limit: APIs.limits.author }): Promise<ISong.track[]> {
        return new Promise(async (resolve, reject) => {
            try {
                let ID: string;

                if (url.match(/@/)) ID = `@${url.split("@")[1]}`;
                else ID = `channel/${url.split("channel/")[1]}`;

                //Создаем запрос
                const channel = await httpsClient.get(`${db.link}/${ID}/videos`, {
                    resolve: "string", cookie: true, useragent: true,
                    headers: {
                        "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                        "accept-encoding": "gzip, deflate, br"
                    }
                }) as string | Error;

                if (channel instanceof Error) return reject(Error("[APIs]: Не удалось получить данные!"));

                const info = channel.split("var ytInitialData = ")[1]?.split(";</script><script nonce=")[0];

                //Если нет данных на странице
                if (!info) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(info);
                const tabs: any[] = details?.contents?.twoColumnBrowseResultsRenderer?.tabs;
                const videos = (tabs[1] ?? tabs[2]).tabRenderer?.content?.richGridRenderer?.contents;
                const author = details.microformat.microformatDataRenderer;
                const endVideos = videos?.filter((video: any) => video?.richItemRenderer?.content?.videoRenderer)?.splice(0, options.limit);

                endVideos.map((video: any) => {
                    return {
                        url: `https://youtu.be/${video.videoId}`, title: video.title.runs[0].text, duration: { seconds: video.lengthText.simpleText },
                        author: { url: `${db.link}${ID}`, title: author.title }
                    }
                });

                return resolve(endVideos);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные о пользователе
 * @param id {string} ID канала
 * @param name {string} Название канала
 */
function getChannel({ id, name }: { id: string, name?: string }): Promise<ISong.author> {
    return new Promise(async (resolve) => {
        //Создаем запрос
        const channel = await httpsClient.get(`${db.link}/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
            resolve: "json",
            headers: {
                "x-youtube-client-name": "1",
                "x-youtube-client-version": "2.20201021.03.00",
                "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                "accept-encoding": "gzip, deflate, br"
            }
        }) as any | Error;

        if (channel instanceof Error) return resolve(null);

        const data = channel[1]?.response ?? channel?.response ?? null as any;
        const info = data?.header?.c4TabbedHeaderRenderer, Channel = data?.metadata?.channelMetadataRenderer,
            avatar = info?.avatar, badges = info?.badges;

        return resolve({
            title: Channel?.title ?? name ?? "Not found name",
            url: `${db.link}/channel/${id}`,
            image: avatar?.thumbnails.pop() ?? null,
            isVerified: !!badges?.find((badge: any) => ["Verified", "Official Artist Channel"].includes(badge?.metadataBadgeRenderer?.tooltip))
        });
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем ID
 * @param url {string} Ссылка
 * @param isPlaylist
 */
function getID(url: string, isPlaylist: boolean = false): string {
    try {
        if (typeof url !== "string") return null;
        const parsedLink = new URL(url);

        if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
        else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
        return parsedLink.pathname.split("/")[1];
    } catch (err) { return null; }
}