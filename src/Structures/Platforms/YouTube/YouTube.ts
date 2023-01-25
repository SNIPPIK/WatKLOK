import {InputAuthor, InputPlaylist, InputTrack} from "@Queue/Song";
import {httpsClient, httpsClientOptions} from "@httpsClient";
import {extractSignature, YouTubeFormat} from "./Decipher";

const VerAuthor = ["Verified", "Official Artist Channel"];

/**
 * @description Получаем ID
 * @param url {string} Ссылка
 * @param isPlaylist
 */
export function getID(url: string, isPlaylist: boolean = false) {
    if (typeof url !== "string") return "Url is not string";
    const parsedLink = new URL(url);

    if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
    else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
    return parsedLink.pathname.split("/")[1];
}

namespace API {
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

namespace construct {
    export async function video(video: any): Promise<InputTrack> {
        return {
            url: `https://youtu.be/${video.videoId}`,
            title: video.title,
            duration: {seconds: video.lengthSeconds},
            image: video.thumbnail.thumbnails.pop(),
            author: await getChannel({ id: video.channelId, name: video.author }),
            isLive: video.isLiveContent
        };
    }
    export function playlist(video: any): InputTrack {
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

export namespace YouTube {
    /**
     * @description Получаем данные о видео
     * @param url {string} Ссылка на видео
     */
    export function getVideo(url: string): Promise<InputTrack> {
        const ID = getID(url);

        return new Promise(async (resolve, reject) => {
            try {
                const page = await API.Request("STRING", `https://www.youtube.com/watch?v=${ID}&has_verified=1`) as string;
                const result = page.split("var ytInitialPlayerResponse = ")?.[1]?.split(";</script>")[0].split(/(?<=}}});\s*(var|const|let)\s/)[0];

                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));
                const jsonResult = JSON.parse(result);

                if (jsonResult.playabilityStatus?.status !== "OK") return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = jsonResult.videoDetails;
                let audios: YouTubeFormat;

                if (details.isLiveContent) audios = {url: details.streamingData?.dashManifestUrl ?? null}; //dashManifestUrl, hlsManifestUrl
                else {
                    const html5player = `https://www.youtube.com${page.split('"jsUrl":"')[1].split('"')[0]}`;

                    audios = (await extractSignature([...jsonResult.streamingData?.formats ?? [], ...jsonResult.streamingData?.adaptiveFormats ?? []], html5player));
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
    export function getPlaylist(url: string): Promise<InputPlaylist> {
        const ID = getID(url, true);

        return new Promise(async (resolve, reject) => {
            try {
                const page = await API.Request("STRING", `https://www.youtube.com/playlist?list=${ID}`) as string;
                const result = page.split('var ytInitialData = ')[1].split(';</script>')[0].split(/;\s*(var|const|let)\s/)[0];

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
    export function SearchVideos(search: string, options = {limit: 15}): Promise<InputTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const page = await API.Request("STRING", `https://www.youtube.com/results?search_query=${search.replaceAll(' ', '+')}`) as string;
                const result = (page.split("var ytInitialData = ")[1].split("}};")[0] + '}}').split(';</script><script')[0];

                if (!result) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(result)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;

                if (!details) return reject(Error(`[APIs]: Не удалось найти: ${search}`));

                const videos: InputTrack[] = [];
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


                const channel: any[] | any = await API.Request("STRING", `https://www.youtube.com/${ID}/videos`);
                const info = channel.split("var ytInitialData = ")[1]?.split(";</script><script nonce=")[0];

                if (!info) return reject(Error("[APIs]: Не удалось получить данные!"));

                const details = JSON.parse(info);
                const tabs: any[] = details?.contents?.twoColumnBrowseResultsRenderer?.tabs;
                const videos = (tabs[1] ?? tabs[2]).tabRenderer?.content?.richGridRenderer?.contents;
                const author = details.microformat.microformatDataRenderer;

                const endVideos: InputTrack[] = [];
                for (let i = 0; i < videos.length; i++) {
                    if (i >= 5) break;

                    const video = videos[i]?.richItemRenderer?.content?.videoRenderer;

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
function getChannel({id, name}: ChannelPageBase): Promise<InputAuthor> {
    return new Promise(async (resolve) => {
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
            isVerified: !!badges?.find((badge: any) => VerAuthor.includes(badge?.metadataBadgeRenderer?.tooltip))
        });
    });
}

interface ChannelPageBase {
    id: string;
    name?: string;
}