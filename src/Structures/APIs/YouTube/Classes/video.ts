import {extractSignature, YouTubeFormat} from "../Decipher";
import {ISong} from "@AudioPlayer/Structures/Song";
import {httpsClient} from "@httpsClient";
import {YouTubeUtils} from "../Utils";
import {API} from "@Structures/APIs";

export class YouTube_Video implements API.track {
    public readonly type = "track";
    public readonly filter = /(watch)?(embed)?(be)/gi;

    public readonly callback = (url: string) => {
        const ID = YouTubeUtils.getID(url);

        return new Promise<ISong.track>(async (resolve, reject) => {
            //Если ID видео не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

            try {
                //Создаем запрос
                const result = await API_get(ID);

                //Если возникла ошибка при получении данных
                if (result instanceof Error) return reject(Error);

                const video = await constructVideo(result);
                video.format = await extractSignature(result.originalFormats, result.htmlPlayer);

                return resolve(video);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)); }
        });
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем страницу и ищем на ней данные
 * @param ID {string} ID Видео
 */
function API_get(ID: string): Promise<Error | any> {
    return new Promise(async (resolve) => {
        const page = await new httpsClient(`https://www.youtube.com/watch?v=${ID}&has_verified=1`, {
            cookie: true, useragent: true,
            headers: {
                "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                "accept-encoding": "gzip, deflate, br"
            }
        }).toString;

        if (page instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

        const result = JSON.parse(page?.split("var ytInitialPlayerResponse = ")?.[1]?.split(";</script>")[0]?.split(/(?<=}}});\s*(var|const|let)\s/)[0]);

        //Если нет данных на странице
        if (!result) return resolve(Error("[APIs]: Не удалось получить данные!"));

        //Если статус получения данные не OK
        if (result.playabilityStatus?.status === "LOGIN_REQUIRED") return resolve(Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`));
        else if (result.playabilityStatus?.status !== "OK") return resolve(Error(`[APIs]: Не удалось получить данные! Status: ${result?.playabilityStatus?.status}`));

        result.videoDetails.htmlPlayer = `https://www.youtube.com${page.split('"jsUrl":"')[1].split('"')[0]}`;
        result.videoDetails.originalFormats = [] as YouTubeFormat[];

        //Если видео является потоком
        if (result.videoDetails.isLiveContent) result.videoDetails.originalFormats.push({url: result.videoDetails.streamingData?.dashManifestUrl ?? null});
        else {
            const format: YouTubeFormat = (result.streamingData?.formats && result.streamingData?.adaptiveFormats).
            find((format: YouTubeFormat) => format.mimeType.match(/opus/));

            result.videoDetails.originalFormats.push(format);
        }

        return resolve(result.videoDetails);
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Заготавливаем данные о видео для Queue<songs>
 * @param video {any} Видео
 */
function constructVideo(video: any): Promise<ISong.track> {
    return new Promise(async (resolve) => {
        return resolve({
            url: `https://youtu.be/${video.videoId}`,
            title: video.title,
            duration: {seconds: video.lengthSeconds},
            image: video.thumbnail.thumbnails.pop(),
            author: await YouTubeUtils.getChannel({id: video.channelId, name: video.author}),
            isLive: video.isLiveContent
        });
    });
}