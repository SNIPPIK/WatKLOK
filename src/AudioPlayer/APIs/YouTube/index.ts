import {inAuthor, inPlaylist, inTrack} from "@Queue/Song";
import {httpsClient, httpsClientOptions} from "@httpsClient";
import {YouTubeFormat} from "./Decipher";
import {Worker} from "worker_threads";

//====================== ====================== ====================== ======================
/**
 * Простой парсер youtube
 * Некоторое взято у ytdl-core (Decipher или extractorSignature)
 */
//====================== ====================== ====================== ======================

/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Создаем парсер по зависимости <type>
     * @param type {"JSON" | "STRING"} Тип запроса
     * @param url {string} Ссылка
     * @param options {httpsClientOptions} Аргументы запроса
     */
    export function Request(type: "JSON" | "STRING", url: string, options: httpsClientOptions = {options: {}, request: {}}): string | {} {
        if (type === "JSON") return httpsClient.parseJson(url, options);
        return httpsClient.parseBody(url, {
            options: {userAgent: true, cookie: true}, request: {
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }
            }
        });
    }
}
//====================== ====================== ====================== ======================

/**
 * @description Формирование общих данных
 */
namespace construct {
    export async function video(video: any): Promise<inTrack> {
        return {
            url: `https://youtu.be/${video.videoId}`,
            title: video.title,
            duration: {seconds: video.lengthSeconds},
            image: video.thumbnail.thumbnails.pop(),
            author: await getChannel({ id: video.channelId, name: video.author }),
            isLive: video.isLiveContent
        };
    }
    export function playlist(video: any): inTrack {
        return {
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            title: video.title.runs[0].text,
            author: {
                title: video.shortBylineText.runs[0].text || undefined,
                url: `https://www.youtube.com${video.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || video.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`
            },
            duration: {seconds: video.lengthSeconds ?? video.lengthText?.simpleText ?? 0},
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
    export function getVideo(url: string): Promise<inTrack> {
        const ID = getID(url);

        return new Promise(async (resolve, reject) => {
            //Если ID видео не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

            try {
                //Создаем запрос
                const page = await API.Request("STRING", `https://www.youtube.com/watch?v=${ID}&has_verified=1`) as string;
                const result = page.split("var ytInitialPlayerResponse = ")?.[1]?.split(";</script>")[0].split(/(?<=}}});\s*(var|const|let)\s/)[0];

                //Если нет данных на странице
                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));
                const jsonResult = JSON.parse(result);

                //Если статус получения данные не OK
                if (jsonResult.playabilityStatus?.status === "LOGIN_REQUIRED") return reject(Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`));
                else if (jsonResult.playabilityStatus?.status !== "OK") return reject(Error(`[APIs]: Не удалось получить данные! Status: ${jsonResult?.playabilityStatus?.status}`));

                const details = jsonResult.videoDetails;
                let audios: YouTubeFormat;

                //Выбираем какой формат у видео из <VideoDetails>.isLiveContent
                if (details.isLiveContent) audios = {url: details.streamingData?.dashManifestUrl ?? null}; //dashManifestUrl, hlsManifestUrl
                else {
                    const html5player = `https://www.youtube.com${page.split('"jsUrl":"')[1].split('"')[0]}`;
                    const format = await runWorkerSignature({
                        formats: [...jsonResult.streamingData?.formats ?? [], ...jsonResult.streamingData?.adaptiveFormats ?? []],
                        html: html5player
                    });

                    //Если формат ну удалось получить из-за ошибки
                    if (format instanceof Error) return reject(format);

                    audios = format;
                }

                return resolve({...await construct.video(details), format: audios});
            } catch (e) { return reject(Error(e)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о плейлисте
     * @param url {string} Ссылка на плейлист
     */
    export function getPlaylist(url: string): Promise<inPlaylist> {
        const ID = getID(url, true);

        return new Promise(async (resolve, reject) => {
            //Если ID плейлиста не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

            try {
                //Создаем запрос
                const page = await API.Request("STRING", `https://www.youtube.com/playlist?list=${ID}`) as string;
                const result = page.split('var ytInitialData = ')[1].split(';</script>')[0].split(/;\s*(var|const|let)\s/)[0];

                //Если нет данных на странице
                if (!result) return reject(new Error("[APIs]: Не удалось получить данные!"));

                const jsonResult = JSON.parse(result);
                const info = jsonResult.sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer;
                const author = jsonResult.sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer;
                const videos: any[] = jsonResult.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0]
                    .itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;

                return resolve({
                    title: info.title.runs[0].text, url,
                    items: videos.map(({playlistVideoRenderer}) => construct.playlist(playlistVideoRenderer)),
                    author: await getChannel({ id: author.navigationEndpoint.browseEndpoint.browseId, name: author.title.runs[0].text }),
                    image: info.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails.pop()
                });
            } catch (e) { return reject(Error(e)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
    * @description Поиск видео на youtube
    * @param search {string} что ищем
    * @param options {limit} Настройки
    */
    export function SearchVideos(search: string, options = {limit: 15}): Promise<inTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const page = await API.Request("STRING", `https://www.youtube.com/results?search_query=${search.replaceAll(' ', '+')}`) as string;
                const result = (page.split("var ytInitialData = ")[1].split("}};")[0] + '}}').split(';</script><script')[0];

                //Если нет данных на странице
                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(result)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;

                //Если нет данных на странице (если нет результатов поиска)
                if (!details) return reject(Error(`[APIs]: Не удалось найти: ${search}`));

                const videos: inTrack[] = [];
                for (let i = 0; i < details.length; i++) {
                    if (i >= options.limit) break;

                    if (!details[i] || !details[i].videoRenderer) continue;

                    const video = details[i].videoRenderer;

                    if (!video.videoId) continue;

                    videos.push(construct.playlist(video));
                }

                return resolve(videos);
            } catch (e) { return reject(Error(e)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем 5 последних треков автора
     * @param url {string} Ссылка на автора
     */
    export function getChannelVideos(url: string) {
        return new Promise(async (resolve, reject) => {
            try {
                let ID: string;

                if (url.match(/@/)) ID = `@${url.split("@")[1]}`;
                else ID = `channel/${url.split("channel/")[1]}`;


                //Создаем запрос
                const channel: any[] | any = await API.Request("STRING", `https://www.youtube.com/${ID}/videos`);
                const info = channel.split("var ytInitialData = ")[1]?.split(";</script><script nonce=")[0];

                //Если нет данных на странице
                if (!info) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(info);
                const tabs: any[] = details?.contents?.twoColumnBrowseResultsRenderer?.tabs;
                const videos = (tabs[1] ?? tabs[2]).tabRenderer?.content?.richGridRenderer?.contents;
                const author = details.microformat.microformatDataRenderer;

                const endVideos: inTrack[] = [];
                for (let i = 0; i < videos.length; i++) {
                    if (i >= 5) break;

                    const video = videos[i]?.richItemRenderer?.content?.videoRenderer;

                    //Если нет <video>, то не добавляем его
                    if (!video) return;

                    endVideos.push({ url: `https://youtu.be/${video.videoId}`, title: video.title.runs[0].text, duration: {seconds: video.lengthText.simpleText},
                        author: { url: `https://www.youtube.com/${ID}`, title: author.title }
                    });
                }

                return resolve(endVideos);
            } catch (e) { return reject(Error(e)) }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные о пользователе
 * @param id {string} ID канала
 * @param name {string} Название канала
 */
function getChannel({id, name}: { id: string, name?: string }): Promise<inAuthor> {
    return new Promise(async (resolve) => {
        //Создаем запрос
        const channel: any[] | any = await API.Request("JSON", `https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
            request: {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00",
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }
            }
        });
        const data = channel[1]?.response ?? channel?.response ?? null as any;
        const info = data?.header?.c4TabbedHeaderRenderer, Channel = data?.metadata?.channelMetadataRenderer,
            avatar = info?.avatar, badges = info?.badges;

        return resolve({
            title: Channel?.title ?? name ?? "Not found name",
            url: `https://www.youtube.com/channel/${id}`,
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
function getID(url: string, isPlaylist: boolean = false) {
    try {
        if (typeof url !== "string") return null;
        const parsedLink = new URL(url);

        if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
        else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
        return parsedLink.pathname.split("/")[1];
    } catch (err) { return null; }
}
//====================== ====================== ====================== ======================
/**
 * @description Запускаем расшифровку на другом потоке
 * @param workerData
 */
function runWorkerSignature(workerData: {}): Promise<YouTubeFormat | Error> {
    return new Promise((resolve) => {
        const worker = new Worker(__dirname + "/Decipher.js", { workerData, resourceLimits: { stackSizeMb: 2, codeRangeSizeMb: 5, maxOldGenerationSizeMb: 15 }});
        worker.once('message', (exitCode) => {
            worker.emit("exit", 0);
            return resolve(exitCode.format);
        });
        worker.once('error', (err) => {
            worker.emit("exit", 0);
            return resolve(Error(`[APIs]: ${err}`));
        });
        worker.once('exit', (code) => {
            if (code !== 0) resolve(Error(`[APIs]: Worker stopped with exit code ${code}`));
            return;
        });
    });
}