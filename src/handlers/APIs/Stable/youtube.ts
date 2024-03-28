import {Song} from "@lib/player/queue/Song";
import {API, Constructor} from "@handler";
import {httpsClient} from "@lib/request";
import querystring from "querystring";
import { URL } from "node:url";
import {Script} from "vm";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class currentAPI
 */
class currentAPI extends Constructor.Assign<API.request> {
    protected static decode = new class {
        private Segment = [
            // Strings
            { s: '"', e: '"' }, { s: "'", e: "'" }, { s: '`', e: '`' },

            // RegEx
            { s: '/', e: '/', prf: /(^|[[{:;,/])\s?$/ || /(^|[[{:;,])\s?$/ }
        ];

        /**
         * @description Применяет преобразование параметра расшифровки и n ко всем URL-адресам формата.
         * @param format - Аудио или видео формат на youtube
         * @param html5player - Ссылка на плеер
         */
        public extractSignature = (format: YouTubeFormat, html5player: string): Promise<YouTubeFormat | Error> => {
            return new Promise(async (resolve) => {
                const body = await new httpsClient(html5player).toString;

                if (!body || body instanceof Error) return resolve(Error(`TypeError: has not found body!`));

                try {
                    const functions = this.extractFunctions(body);
                    const url = this.setDownloadURL(format, {
                        decipher: functions.length ? new Script(functions[0]) : null,
                        nTransform: functions.length > 1 ? new Script(functions[1]) : null
                    });

                    if (url) format.url = url;

                    return resolve(format);
                } catch {
                    return resolve(format);
                }
            });
        };

        /**
         * @description Сопоставление начальной и конечной фигурной скобки входного JS
         * @param mixedJson
         */
        private cutAfterJS = (mixedJson: string): string => {
            let open, close; //Define the general open and closing tag

            if (mixedJson[0] === '[') { open = '['; close = ']'; }
            else if (mixedJson[0] === '{') { open = '{'; close = '}'; }

            if (!open) throw Error(`Can't cut unsupported JSON (need to begin with [ or { ) but got: ${mixedJson[0]}`);

            // counter - Current open brackets to be closed
            // isEscaped - States if the current character is treated as escaped or not
            // isEscapedObject = States if the loop is currently inside an escaped js object
            let counter = 0, isEscaped = false, isEscapedObject = null;

            // Go through all characters from the start
            for (let i = 0; i < mixedJson.length; i++) {
                // End of current escaped object
                if (!isEscaped && isEscapedObject !== null && mixedJson[i] === isEscapedObject.e) { isEscapedObject = null; continue; }
                // Might be the start of a new escaped object
                else if (!isEscaped && isEscapedObject === null) {
                    for (const escaped of this.Segment) {
                        if (mixedJson[i] !== escaped.s) continue;
                        // Test startPrefix against last 10 characters
                        if (!escaped.prf || mixedJson.substring(i - 10, i).match(escaped.prf)) { isEscapedObject = escaped; break; }
                    }
                    // Continue if we found a new escaped object
                    if (isEscapedObject !== null) continue;
                }

                // Toggle the isEscaped boolean for every backslash
                // Reset for every regular character
                isEscaped = mixedJson[i] === '\\' && !isEscaped;

                if (isEscapedObject !== null) continue;

                if (mixedJson[i] === open) counter++;
                else if (mixedJson[i] === close) counter--;

                // All brackets have been closed, thus end of JSON is reached
                if (counter === 0) return mixedJson.substring(0, i + 1);
            }

            // We ran through the whole string and ended up with an unclosed bracket
            throw Error("Can't cut unsupported JSON (no matching closing bracket found)");
        };

        /**
         * @description Применить расшифровку и n-преобразование к индивидуальному формату
         * @param format - Аудио или видео формат на youtube
         * @param script - Скрипт для выполнения на виртуальной машине
         */
        private setDownloadURL = (format: YouTubeFormat, script: {decipher?: Script, nTransform?: Script}): string | void => {
            const url = format.url || format.signatureCipher || format.cipher, {decipher, nTransform} = script;
            const extractDecipher = (url: string): string => {
                const args = querystring.parse(url);
                if (!args.s || !decipher) return args.url as string;

                const components = new URL(decodeURIComponent(args.url as string));
                components.searchParams.set(args.sp as string ? args.sp as string : 'signature', decipher.runInNewContext({sig: decodeURIComponent(args.s as string)}));
                return components.toString();
            }
            const extractN = (url: string): string => {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get('n');
                if (!n || !nTransform) return url;
                components.searchParams.set('n', nTransform.runInNewContext({ncode: n}));
                return components.toString();
            }

            //Удаляем не нужные данные
            delete format.signatureCipher;
            delete format.cipher;

            return !format.url ? extractN(extractDecipher(url)) : extractN(url);
        };

        /**
         * @description Извлечь функции расшифровки подписи и преобразования n параметров из файла html5player
         * @param body - Страница плеера
         */
        private extractFunctions = (body: string): string[] => {
            const functions: string[] = [];

            const decipherName = body.split(`a.set("alr","yes");c&&(c=`)[1].split(`(decodeURIC`)[0];
            let ncodeName = body.split(`&&(b=a.get("n"))&&(b=`)[1].split(`(b)`)[0];

            //extract Decipher
            if (decipherName && decipherName.length) {
                const functionStart = `${decipherName}=function(a)`;
                const ndx = body.indexOf(functionStart);

                if (ndx >= 0) {
                    let functionBody = `var ${functionStart}${this.cutAfterJS(body.slice(ndx + functionStart.length))}`;
                    functions.push(`${this.extractManipulations(functionBody, body)};${functionBody};${decipherName}(sig);`);
                }
            }

            //extract ncode
            if (ncodeName.includes('[')) ncodeName = body.split(`${ncodeName.split('[')[0]}=[`)[1].split(`]`)[0];
            if (ncodeName && ncodeName.length) {
                const functionStart = `${ncodeName}=function(a)`;
                const ndx = body.indexOf(functionStart);

                if (ndx >= 0) functions.push(`var ${functionStart}${this.cutAfterJS(body.slice(ndx + functionStart.length))};${ncodeName}(ncode);`);
            }

            //Проверяем если ли functions
            if (!functions || !functions.length) return;
            return functions;
        };

        /**
         * @description Пытаемся вытащить фрагмент для дальнейшей манипуляции
         * @param caller {string}
         * @param body {string}
         */
        private extractManipulations = (caller: string, body: string): string => {
            const name = caller.split(`a=a.split("");`)[1].split(".")[0];
            const start = `var ${name}={`;
            const index = body.indexOf(start);

            if (!name || index < 0) return '';
            return `var ${name}=${this.cutAfterJS(body.slice(index + start.length - 1))}`;
        };
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor currentAPI
     * @public
     */
    public constructor() {
        super({
            name: "YOUTUBE",
            audio: true,
            auth: true,

            color: 16711680,
            filter: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi,
            url: "youtube.com",

            requests: [
                /**
                 * @description Запрос данных о треке
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /(watch|embed|youtu\.be)/gi,
                            callback: (url: string, {audio}) => {
                                const ID = /[a-zA-Z0-9-_]{11}/.exec(url).pop();

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID видео не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const result = await currentAPI.API(`https://www.youtube.com/watch?v=${ID}&has_verified=1`);

                                        //Если возникла ошибка при получении данных
                                        if (result instanceof Error) return reject(result);

                                        //Если надо получить аудио
                                        if (audio) {
                                            const format = await currentAPI.extractStreamingData(result["streamingData"], result["html5"]);
                                            result["videoDetails"]["format"] = {url: format.url};
                                        }

                                        const track = currentAPI.track(result["videoDetails"]);
                                        return resolve(track);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных об плейлисте
                 */
                new class extends API.item<"playlist"> {
                    public constructor() {
                        super({
                            name: "playlist",
                            filter: /playlist\?list=[a-zA-Z0-9-_]+/gi,
                            callback: (url: string, {limit}) => {
                                const ID = url.match(this.filter);
                                let author = null;

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const details = await currentAPI.API(`https://www.youtube.com/${ID.pop()}`);

                                        if (details instanceof Error) return reject(details);

                                        const sidebar: any[] = details["sidebar"]["playlistSidebarRenderer"]["items"];
                                        const microformat: any = details["microformat"]["microformatDataRenderer"];
                                        const items: Song[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                            .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"]
                                            .splice(0, limit).map(({playlistVideoRenderer}) => currentAPI.track(playlistVideoRenderer));

                                        //Если нет автора плейлиста, то это альбом автора
                                        if (sidebar.length > 1) {
                                            const authorData = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                                            author = await currentAPI.getChannel({ id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"], name: authorData.title["runs"][0].text });
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
                 * @description Запрос данных треков артиста
                 */
                new class extends API.item<"artist"> {
                    public constructor() {
                        super({
                            name: "artist",
                            filter: /\/(channel)?(@)/gi,
                            callback: (url: string, {limit}) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        let ID: string;

                                        if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                                        else ID = `channel/${url.split("channel/")[1]}`;

                                        //Создаем запрос
                                        const details = await currentAPI.API(`https://www.youtube.com/${ID}/videos`);

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
                 */
                new class extends API.item<"search"> {
                    public constructor() {
                        super({
                            name: "search",
                            callback: (url: string, {limit}) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const details = await currentAPI.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                        //Если при получении данных возникла ошибка
                                        if (details instanceof Error) return reject(details);

                                        let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                        if (vanilla_videos?.length === 0 || !vanilla_videos) return reject(Error(`[APIs]: Не удалось найти: ${url}`));

                                        let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                        let videos = filtered_.map(({ videoRenderer }: any) => currentAPI.track(videoRenderer));

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
    protected static extractStreamingData = (data: any, html5player: string): Promise<YouTubeFormat> => {
        return new Promise(async (resolve) => {
            const format = (data["adaptiveFormats"] as YouTubeFormat[]).find((item) => item.mimeType.match(/opus|audio/) && !item.mimeType.match(/ec-3/));
            const decoded = await this.decode.extractSignature(format, html5player);

            if (decoded instanceof Error) return resolve(null);
            return resolve(decoded);
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
export default Object.values({currentAPI});


/**
 * @description Так выглядит youtube video or audio format
 */
interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
}