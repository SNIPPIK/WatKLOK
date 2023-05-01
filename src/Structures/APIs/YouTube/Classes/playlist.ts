import {httpsClient} from "@httpsClient";
import {ISong} from "@AudioPlayer/Structures/Song";
import {YouTubeUtils} from "../Utils";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.playlist;

export class YouTube_playlist implements API.list {
    public readonly type = "playlist";
    public readonly filter = /playlist\?list=/gi;

    public readonly callback = (url: string) => {
        const ID = YouTubeUtils.getID(url, true);

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID плейлиста не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

            try {
                //Создаем запрос
                const details = await API_get(ID);

                if (details instanceof Error) return reject(details);

                const info = details.sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer;
                const author = details.sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer;
                const contents: any[] = details.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0]
                    .itemSectionRenderer.contents[0].playlistVideoListRenderer.contents.splice(0, Limit);

                //Модифицируем видео
                const videos = contents.map(({ playlistVideoRenderer }) => constructVideo(playlistVideoRenderer));

                return resolve({
                    title: info.title.runs[0].text, url,
                    items: videos,
                    author: await YouTubeUtils.getChannel({ id: author.navigationEndpoint.browseEndpoint.browseId, name: author.title.runs[0].text }),
                    image: info.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails.pop()
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем страницу и ищем на ней данные
 * @param ID {string} ID плейлиста
 */
function API_get(ID: string): Promise<Error | any> {
    return new Promise((resolve) => {
        return new httpsClient(`https://www.youtube.com/playlist?list=${ID}`, {
            cookie: true, useragent: true,
            headers: {
                "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                "accept-encoding": "gzip, deflate, br"
            }
        }).toString.then((page) => {
            if (page instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

            const result = page.split('var ytInitialData = ')[1].split(';</script>')[0].split(/;\s*(var|const|let)\s/)[0];

            //Если нет данных на странице
            if (!result) return resolve(new Error("[APIs]: Не удалось получить данные!"));

            const jsonResult = JSON.parse(result);

            return resolve(jsonResult);
        }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Заготавливаем данные о видео для Queue<songs>
 * @param video {any} Видео
 */
function constructVideo(video: any): ISong.track {
    return {
        url: `https://youtu.be/${video.videoId}`,
        title: video.title.runs[0].text,
        author: {
            title: video.shortBylineText.runs[0].text || undefined,
            url: `https://www.youtube.com${video.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || video.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`
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