import {httpsClient} from "@httpsClient";
import {ISong} from "@AudioPlayer/Structures/Song";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.author;

export class YouTube_Artist implements API.array {
    public readonly type = "artist";
    public readonly filter = /(channel)?(@)/gi;

    public callback = (url: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                let ID: string;

                if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                else ID = `channel/${url.split("channel/")[1]}`;

                //Создаем запрос
                const details = await API_get(ID);

                if (details instanceof Error) return reject(details);

                const author = details.microformat.microformatDataRenderer;
                const tabs: any[] = details?.contents?.twoColumnBrowseResultsRenderer?.tabs;
                const videos = (tabs[1] ?? tabs[2]).tabRenderer?.content?.richGridRenderer?.contents
                    ?.filter((video: any) => video?.richItemRenderer?.content?.videoRenderer)?.splice(0, Limit);

                //Модифицируем видео
                videos.map(({richItemRenderer}: any) => {
                    const video = richItemRenderer?.content?.videoRenderer;

                    return {
                        url: `https://youtu.be/${video.videoId}`, title: video.title.runs[0].text, duration: { seconds: video.lengthText.simpleText },
                        author: { url: `https://www.youtube.com${ID}`, title: author.title }
                    }
                });

                return resolve(videos);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)); }
        });
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем страницу и ищем на ней данные
 * @param ID {string} ID автора
 */
function API_get(ID: string): Promise<Error | any> {
    return new Promise(async (resolve) => {
        //Создаем запрос
        const channel = await new httpsClient(`https://www.youtube.com/${ID}/videos`, {
            cookie: true, useragent: true,
            headers: {
                "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                "accept-encoding": "gzip, deflate, br"
            }
        }).toString as string | Error;

        if (channel instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

        const info = channel.split("var ytInitialData = ")[1]?.split(";</script><script nonce=")[0];

        //Если нет данных на странице
        if (!info) return resolve(Error("[APIs]: Не удалось получить данные!"));

        const details = JSON.parse(info);

        return resolve(details);
    });
}