import {Youtube_decoder} from "@lib/voice/player/decoder/youtube";
import {Song} from "@lib/voice/player/queue/Song";
import {API, Constructor} from "@handler";
import {httpsClient} from "@lib/request";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class cAPI
 */
class cAPI extends Constructor.Assign<API.request> {
    /**
     * @description Создаем экземпляр запросов
     * @constructor cAPI
     * @public
     */
    public constructor() {
        super({
            name: "YOUTUBE",
            audio: true,
            auth: true,

            color: 16711680,
            filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/gi,
            url: "youtube.com",

            requests: [
                /**
                 * @description Запрос данных об плейлисте
                 * @type playlist
                 */
                new class extends API.item<"playlist"> {
                    public constructor() {
                        super({
                            name: "playlist",
                            filter: /playlist\?list=[a-zA-Z0-9-_]+/gi,
                            callback: (url: string, {limit}) => {
                                const ID = url.match(this.filter).pop();
                                let author = null;

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const details = await cAPI.API(`https://www.youtube.com/${ID}`);

                                        if (details instanceof Error) return reject(details);

                                        const sidebar: any[] = details["sidebar"]["playlistSidebarRenderer"]["items"];
                                        const microformat: any = details["microformat"]["microformatDataRenderer"];
                                        const items: Song[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                            .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"]
                                            .splice(0, limit).map(({playlistVideoRenderer}) => cAPI.track(playlistVideoRenderer));

                                        //Если нет автора плейлиста, то это альбом автора
                                        if (sidebar.length > 1) {
                                            const authorData = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                                            author = await cAPI.getChannel({ id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"], name: authorData.title["runs"][0].text });
                                        } else author = items.at(-1).author;

                                        return resolve({
                                            url, title: microformat.title, items, author,
                                            image: microformat.thumbnail["thumbnails"].pop()
                                        });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных о треке
                 * @type track
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/gi,
                            callback: (url: string, {audio}) => {
                                const ID = this.filter.exec(url).at(0);

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID видео не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const result = await cAPI.API(`https://www.youtube.com/watch?v=${ID}&has_verified=1`);

                                        //Если возникла ошибка при получении данных
                                        if (result instanceof Error) return reject(result);

                                        //Если надо получить аудио
                                        if (audio) {
                                            const format = await cAPI.extractStreamingData(result["streamingData"], result["html5"]);
                                            result["videoDetails"]["format"] = {url: format["url"]};
                                        }

                                        const track = cAPI.track(result["videoDetails"]);
                                        return resolve(track);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных треков артиста
                 * @type author
                 */
                new class extends API.item<"author"> {
                    public constructor() {
                        super({
                            name: "author",
                            filter: /\/(channel)?(@)/gi,
                            callback: (url: string, {limit}) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        let ID: string;

                                        if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                                        else ID = `channel/${url.split("channel/")[1]}`;

                                        //Создаем запрос
                                        const details = await cAPI.API(`https://www.youtube.com/${ID}/videos`);

                                        if (details instanceof Error) return reject(details);

                                        const author = details["microformat"]["microformatDataRenderer"];
                                        const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                                        const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                                            ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, limit);

                                        //Модифицируем видео
                                        const videos = contents.map(({richItemRenderer}: any) => {
                                            const video = richItemRenderer?.content?.["videoRenderer"];

                                            return {
                                                url: `https://youtu.be/${video["videoId"]}`, title: video.title["runs"][0].text, duration: { full: video["lengthText"]["simpleText"] },
                                                author: { url: `https://www.youtube.com${ID}`, title: author.title }
                                            }
                                        });

                                        return resolve(videos);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        })
                    };
                },

                /**
                 * @description Запрос данных по поиску
                 * @type search
                 */
                new class extends API.item<"search"> {
                    public constructor() {
                        super({
                            name: "search",
                            callback: (url: string, {limit}) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const details = await cAPI.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                        //Если при получении данных возникла ошибка
                                        if (details instanceof Error) return reject(details);

                                        let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                        if (vanilla_videos?.length === 0 || !vanilla_videos) return reject(Error(`[APIs]: Не удалось найти: ${url}`));

                                        let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                        let videos = filtered_.map(({ videoRenderer }: any) => cAPI.track(videoRenderer));

                                        return resolve(videos);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        })
                    };
                }
            ]
        });
    };

    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url {string} Ссылка на видео
     */
    protected static API = (url: string): Promise<Error | any> => {
        return new Promise((resolve) => {
            new httpsClient(url, {useragent: true,
                headers: { "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7", "accept-encoding": "gzip, deflate, br" }
            }).toString.then((api) => {
                //Если возникает ошибка при получении страницы
                if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                //Ищем данные на странице
                const data = this.extractInitialDataResponse(api);

                //Если возникает ошибка при поиске на странице
                if (data instanceof Error) return resolve(data);

                const html5Player = /<script\s+src="([^"]+)"(?:\s+type="text\/javascript")?\s+name="player_ias\/base"\s*>|"jsUrl":"([^"]+)"/.exec(api);
                Object.assign(data, { html5: `https://www.youtube.com${html5Player ? html5Player[1] || html5Player[2] : null}`});

                return resolve(data);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем данные из страницы
     * @param input {string} Страница
     */
    protected static extractInitialDataResponse = (input: string): any | Error | null => {
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
    protected static extractStreamingData = (data: any, html5player: string) => {
        return new Promise(async (resolve) => {
            const format = (data["adaptiveFormats"]).filter((item: any) => item.mimeType.match(/opus|audio/) && !item.mimeType.match(/ec-3/));
            const decoded = await Youtube_decoder.decipherFormats(format, html5player);

            if (decoded instanceof Error) return resolve(null);
            return resolve(decoded.at(-1));
        });
    };

    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    protected static getChannel = ({ id, name }: { id: string, name?: string }): Promise<Song.author> => {
        return new Promise<Song.author>((resolve) => {
            new httpsClient(`https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00",
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }
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
     */
    protected static track(track: any): any {
        try {
            return new Song({
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title?.["runs"][0]?.text ?? track.title,
                author: {
                    title: track["shortBylineText"]["runs"][0].text ?? track.author ?? undefined,
                    url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
                },
                duration: { seconds: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0 },
                image: track.thumbnail["thumbnails"].pop(),
                link: track?.format?.url || undefined
            });
        } catch {
            return new Song({
                author: { title: track.author, url: `https://www.youtube.com/channel/${track.channelId}` },
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title,
                duration: { seconds: track["lengthSeconds"] ?? 0 },
                image: track.thumbnail["thumbnails"].pop(),
                link: track?.format?.url || undefined
            })
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({cAPI});