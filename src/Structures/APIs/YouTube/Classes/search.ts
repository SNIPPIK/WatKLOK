import {httpsClient} from "@httpsClient";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.search;

export class YouTube_Search implements API.array {
    public readonly type = "search";

    public readonly callback = (search: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const details = await API_get(search);

                //Если при получении данных возникла ошибка
                if (details instanceof Error) return reject(details);

                const videos = details.map(({ videoRenderer }: any) => constructVideo(videoRenderer))

                return resolve(videos);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };

}
//====================== ====================== ====================== ======================
/**
 * @description Получаем страницу и ищем на ней данные
 * @param search {string} Что ищем
 */
function API_get(search: string): Promise<Error | any> {
    return new Promise((resolve) => {
        return new httpsClient(`https://www.youtube.com/results?search_query=${search.split(" ").join("+")}`, {
            cookie: true, useragent: true,
            headers: {
                "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                "accept-encoding": "gzip, deflate, br"
            }
        }).toString.then((page) => {
            if (page instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

            const result = (page.split("var ytInitialData = ")[1].split("}};")[0] + '}}').split(';</script><script')[0];

            //Если нет данных на странице
            if (!result) return resolve(Error("[APIs]: Не удалось получить данные!"));

            const details = JSON.parse(result)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;

            //Если нет данных на странице (если нет результатов поиска)
            if (!details) return resolve(Error(`[APIs]: Не удалось найти: ${search}`));

            const videos = details?.filter((video: any) => video && video?.videoRenderer && video?.videoRenderer?.videoId)?.splice(0, Limit);

            if (videos.length < 1) return resolve(Error(`[APIs]: Не удалось найти: ${search}`));

            return resolve(videos);
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
            url: `https://youtu.be${video.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || video.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`
        },
        duration: { seconds: video?.lengthSeconds ?? video?.lengthText?.simpleText ?? 0 },
        image: {
            url: video.thumbnail.thumbnails.pop().url,
            height: video.thumbnail.thumbnails.pop()?.height,
            width: video.thumbnail.thumbnails.pop()?.width
        },
        isLive: video?.isLive || video?.is_live
    };
}