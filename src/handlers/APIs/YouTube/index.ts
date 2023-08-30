import {ISong} from "@AudioPlayer/Queue/Song";
import {extractSignature} from "./Signature";
import {httpsClient} from "@Request";

export default class YouTube {
    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url {string} Ссылка на видео
     */
    protected API = (url: string): Promise<Error | any> => {
        return new Promise((resolve) => {
            new httpsClient(url, {cookie: true, useragent: true, proxy: true,
                headers: { "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7", "accept-encoding": "gzip, deflate, br" }
            }).toString.then((api) => {
                //Если возникает ошибка при получении страницы
                if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                //Ищем данные на странице
                const data = this.extractInitialDataResponse(api);

                //Если возникает ошибка при поиске на странице
                if (data instanceof Error) return resolve(data);

                data["html5"] = `https://www.youtube.com${api.split('"jsUrl":"')[1].split('"')[0]}`;
                return resolve(data);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };


    /**
     * @description Получаем данные из страницы
     * @param input {string} Страница
     */
    private extractInitialDataResponse = (input: string): any | Error | null => {
        const startPattern: string = input.match("var ytInitialPlayerResponse = ") ? "var ytInitialPlayerResponse = " : "var ytInitialData = ";
        const startIndex = input.indexOf(startPattern);
        const endIndex = input.indexOf("};", startIndex + startPattern.length);

        //Если нет данных
        if (startIndex === -1 && endIndex === -1) return null;

        const data = JSON.parse(input.substring(startIndex + startPattern.length, endIndex + 1));

        //Если при получении данных происходит что-то не так
        if (!data) return Error("[APIs]: Не удалось получить данные!");

        //Если есть статус, то проверяем
        if (data["playabilityStatus"]?.status) {
            if (data["playabilityStatus"]?.status === "LOGIN_REQUIRED") return Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`);
            else if (data["playabilityStatus"]?.status !== "OK") return Error(`[APIs]: Не удалось получить данные! Status: ${data["playabilityStatus"]?.status}`);
        }

        return data;
    };


    /**
     * @description Получаем аудио дорожки
     * @param data {any} <videoData>.streamingData
     * @param html5player {string} Ссылка на плеер дешифровки
     */
    protected extractStreamingData = async (data: any, html5player: string) => {
        let videos = [];

        for (const item of data["adaptiveFormats"]) {
            if (item.mimeType.match(/audio/)) {
                videos.push(await extractSignature(item, html5player));
                break;
            }
        }

        return videos?.pop();
    };


    /**
     * @description Получаем ID
     * @param url {string} Ссылка
     * @param isPlaylist
     */
    protected getID = (url: string, isPlaylist: boolean = false): string => {
        try {
            if (typeof url !== "string") return null;
            const parsedLink = new URL(url);

            if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
            else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
            else if (url.match(/shorts/)) return parsedLink.pathname.split("/").pop();
            return parsedLink.pathname.split("/")[1];
        } catch (err) { return null; }
    };


    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    protected getChannel = ({ id, name }: { id: string, name?: string }): Promise<ISong.author> => {
        return new Promise<ISong.author>((resolve) => {
            new httpsClient(`https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00",
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }, proxy: true
            }).toJson.then((channel) => {
                if (channel instanceof Error) return resolve(null);

                const data = channel[1]?.response ?? channel?.response ?? null as any;
                const info = data?.header?.["c4TabbedHeaderRenderer"], Channel = data?.metadata?.["channelMetadataRenderer"],
                    avatar = info?.avatar;

                return resolve({
                    title: Channel?.title ?? name ?? "Not found name",
                    url: `https://www.youtube.com/channel/${id}`,
                    image: avatar?.["thumbnails"].pop() ?? null
                });
            }).catch(() => resolve(null));
        });
    };


    /**
     * @description Подготавливаем трек к отправке
     * @param track {any} Видео
     * @param sync
     */
    protected track(track: any, sync: true): ISong.track;
    protected track(track: any, sync: false): Promise<ISong.track>;
    protected track(track: any, sync: any): any {
        if (sync) return {
            url: `https://youtu.be/${track["videoId"]}`,
            title: track.title?.["runs"][0]?.text ?? track.title,
            author: {
                title: track["shortBylineText"]["runs"][0].text ?? track.author ?? undefined,
                url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
            },
            duration: {seconds: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0},
            image: track.thumbnail["thumbnails"].pop(),
            isLive: track["isLiveContent"] ?? track["isLive"] ?? track["is_live"],
            format: track?.format || undefined
        };

        return new Promise(async (resolve) => {
            return resolve({
                author: await this.getChannel({id: track.channelId, name: track.author}),
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title,
                duration: {seconds: track["lengthSeconds"] ?? 0},
                image: track.thumbnail["thumbnails"].pop(),
                isLive: track["isLiveContent"],
                format: track?.format || undefined
            });
        });
    };
}