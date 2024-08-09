import {Song} from "@lib/voice/player/queue/Song";
import * as querystring from "node:querystring";
import {API, Constructor} from "@handler";
import {httpsClient} from "@lib/request";
import {Script} from "vm";
import {env} from "@env";

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
                            callback: (url: string, { audio}) => {
                                const ID = this.filter.exec(url)?.at(0) ?? this.filter.exec(url)[0];

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID видео не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                                    try {
                                        let result = null;

                                        if (env.get("token.youtube") !== "null") {
                                            //Создаем запрос
                                            result = await AIza_Decoder.API(ID);

                                            ///Если при получении данных возникла ошибка
                                            if (result instanceof Error) return reject(result);

                                            //Если надо получить аудио
                                            if (audio) {
                                                const format = await cAPI.extractFormat(result["streamingData"]);
                                                result["videoDetails"]["format"] = {url: format["url"]};
                                            }
                                        } else {
                                            //Создаем запрос
                                            result = await cAPI.API(ID);

                                            ///Если при получении данных возникла ошибка
                                            if (result instanceof Error) return reject(result);

                                            //Если надо получить аудио
                                            if (audio) {
                                                const formats = await Signature_Extractor.decipherFormats(result["streamingData"], getHTML5player(result));

                                                const format = await cAPI.extractFormat(formats);
                                                result["videoDetails"]["format"] = {url: format["url"]};
                                            }
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
     */
    protected static extractFormat = (data: any) => {
        return new Promise(async (resolve) => {
            // Проверяем все форматы аудио и видео
            for (const format of (data["adaptiveFormats"])) {
                if (!format.url) continue;

                // Если это аудио, то проверяем его
                else if (format.mimeType.match(/opus|audio/) && !format.mimeType.match(/ec-3/)) {
                    if (!format.url.startsWith("https")) format.url = format.url.split("https://")[1];
                    return resolve(format);
                }
            }
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
 * @author SNIPPIK
 * @description Создаем запрос при помощи ключа
 * @class AIza_Decoder
 */
class AIza_Decoder {
    private static AIza = `AIzaSyB-${this.AIkey(17)}_${this.AIkey(13)}`

    /**
     * @description Делаем запрос через API player youtubeAI
     * @param ID {string} ID данных
     */
    public static API = (ID: string): Promise<Error | any> => {
        return new Promise((resolve) => {
            new httpsClient(`https://www.youtube.com/youtubei/v1/player?key${this.AIza}&prettyPrint=false`, {
                method: "POST",
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'IOS',
                            clientVersion: '19.09.3',
                            deviceModel: 'iPhone14,3',
                            userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
                            hl: 'en',
                            timeZone: 'UTC',
                            utcOffsetMinutes: 0
                        }
                    },
                    videoId: ID,
                    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
                    contentCheckOk: true,
                    racyCheckOk: true
                }),
                headers: {
                    'X-YouTube-Client-Name': '5',
                    'X-YouTube-Client-Version': '19.09.3',
                    Origin: 'https://www.youtube.com',
                    'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
                    'content-type': 'application/json'
                }
            }).toJson.then((api) => {
                //Если возникает ошибка при получении страницы
                if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                //Если есть статус, то проверяем
                if (api["playabilityStatus"]?.status) {
                    if (api["playabilityStatus"]?.status === "LOGIN_REQUIRED") return resolve(Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`));
                    else if (api["playabilityStatus"]?.status !== "OK") return resolve(Error(`[APIs]: Не удалось получить данные! Status: ${api["playabilityStatus"]?.status}`));
                }

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Генерируем ключ для запросов на youtube
     * @param length - Размер ключа
     * @private
     */
    private static AIkey(length: number) {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < length) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    };
}

const getHTML5player = (body: string) => {
    let html5playerRes =
        /<script\s+src="([^"]+)"(?:\s+type="text\/javascript")?\s+name="player_ias\/base"\s*>|"jsUrl":"([^"]+)"/
            .exec(body);
    return html5playerRes ? html5playerRes[1] || html5playerRes[2] : null;
};

/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param regex - Как искать имена
 * @param body - Строка где будем искать
 * @param first - Выдача первого объекта
 */
const mRegex = (regex: string | RegExp, body: string, first: boolean = true) => {
    const reg =  body.match(new RegExp(regex, "s"));
    return first ? reg[0] : reg[1];
};

/**
 * @author SNIPPIK
 * @description Получаем имена функций
 * @param body - Станица youtube
 * @param regexps
 */
const extractName = (body: string, regexps: string[]): string => {
    let name: string = "";

    for (const regex of regexps) {
        try {
            name = mRegex(regex, body, false);
            try {
                name = mRegex(`${name.replace(/\$/g, '\\$')}=\\[([a-zA-Z0-9$\\[\\]]{2,})\\]`, body, false);
            } catch (err) {
                // Function name is not inside an array
            }
            break;
        } catch (err) {}
    }
    if (!name || name.includes('[')) throw Error();
    return name;
};

/**
 * @author SNIPPIK
 * @description Функции для расшифровки
 */
const extractors: { name: string, callback: (body: string) => string }[] = [
    /**
     * @description Получаем функцию с данными
     */
    {
        name: "extractDecipherFunction",
        callback: (body) => {
            try {
                const helperObject = mRegex(HELPER_REGEXP, body);
                const decipherFunc = mRegex(DECIPHER_REGEXP, body);
                const resultFunc = `var ${DECIPHER_FUNC_NAME}=${decipherFunc};`;
                const callerFunc = `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;
                return helperObject + resultFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    },

    /**
     * @description Получаем имя функции
     */
    {
        name: "extractDecipher",
        callback: (body) => {
            try {
                const decipherFuncName = extractName(body, DECIPHER_NAME_REGEXPS);
                const funcPattern = `(${decipherFuncName.replace(/\$/g, '\\$')}=function\\([a-zA-Z0-9_]+\\)\\{.+?\\})`;
                const decipherFunc = `var ${mRegex(funcPattern, body, false)};`;
                const helperObjectName = mRegex(";([A-Za-z0-9_\\$]{2,})\\.\\w+\\(", decipherFunc, false);
                const helperPattern = `(var ${helperObjectName.replace(/\$/g, '\\$')}=\\{[\\s\\S]+?\\}\\};)`;
                const helperObject = mRegex(helperPattern, body, false);
                const callerFunc = `${decipherFuncName}(${DECIPHER_ARGUMENT});`;
                return helperObject + decipherFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    },

    /**
     * @description Получаем данные n кода - для ускоренной загрузки с серверов
     */
    {
        name: "extractTransform",
        callback: (body) => {
            try {
                const nFunc = mRegex(N_TRANSFORM_REGEXP, body);
                const resultFunc = `var ${N_TRANSFORM_FUNC_NAME}=${nFunc}`;
                const callerFunc = `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;
                return resultFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    },

    {
        name: "extractorTransformName",
        callback: (body) => {
            try {
                const nFuncName = extractName(body, N_TRANSFORM_NAME_REGEXPS);
                const funcPattern = `(${
                    nFuncName.replace(/\$/g, '\\$')
                    // eslint-disable-next-line max-len
                }=\\s*function([\\S\\s]*?\\}\\s*return (([\\w$]+?\\.join\\(""\\))|(Array\\.prototype\\.join\\.call\\([\\w$]+?,[\\n\\s]*(("")|(\\("",""\\)))\\)))\\s*\\}))`;
                const nTransformFunc = `var ${mRegex(funcPattern, body, false)};`;
                const callerFunc = `${nFuncName}(${N_ARGUMENT});`;
                return nTransformFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    }
];

/**
 * @description Общий стандарт аудио или видео json объекта
 * @interface YouTubeFormat
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


// NewPipeExtractor regexps
const DECIPHER_NAME_REGEXPS = [
    '\\bm=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(h\\.s\\)\\)',
    '\\bc&&\\(c=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(c\\)\\)',
    // eslint-disable-next-line max-len
    '(?:\\b|[^a-zA-Z0-9$])([a-zA-Z0-9$]{2,})\\s*=\\s*function\\(\\s*a\\s*\\)\\s*\\{\\s*a\\s*=\\s*a\\.split\\(\\s*""\\s*\\)',
    '([\\w$]+)\\s*=\\s*function\\((\\w+)\\)\\{\\s*\\2=\\s*\\2\\.split\\(""\\)\\s*;',
];

const DECIPHER_FUNC_NAME = 'DisTubeDecipherFunc';
const N_TRANSFORM_FUNC_NAME = 'DisTubeNTransformFunc';

// LavaPlayer regexps
const VARIABLE_PART = '[a-zA-Z_\\$][a-zA-Z_0-9]*';
const VARIABLE_PART_DEFINE = `\\"?${VARIABLE_PART}\\"?`;
const BEFORE_ACCESS = '(?:\\[\\"|\\.)';
const AFTER_ACCESS = '(?:\\"\\]|)';
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ':function\\(a\\)\\{(?:return )?a\\.reverse\\(\\)\\}';
const SLICE_PART = ':function\\(a,b\\)\\{return a\\.slice\\(b\\)\\}';
const SPLICE_PART = ':function\\(a,b\\)\\{a\\.splice\\(0,b\\)\\}';
const SWAP_PART = ':function\\(a,b\\)\\{' +
    'var c=a\\[0\\];a\\[0\\]=a\\[b%a\\.length\\];a\\[b(?:%a.length|)\\]=c(?:;return a)?\\}';

const DECIPHER_REGEXP = `function(?: ${VARIABLE_PART})?\\(a\\)\\{` +
    `a=a\\.split\\(""\\);\\s*` +
    `((?:(?:a=)?${VARIABLE_PART}${VARIABLE_PART_ACCESS}\\(a,\\d+\\);)+)` +
    `return a\\.join\\(""\\)` +
    `\\}`;

const HELPER_REGEXP = `var (${VARIABLE_PART})=\\{((?:(?:${
    VARIABLE_PART_DEFINE}${REVERSE_PART}|${
    VARIABLE_PART_DEFINE}${SLICE_PART}|${
    VARIABLE_PART_DEFINE}${SPLICE_PART}|${
    VARIABLE_PART_DEFINE}${SWAP_PART}),?\\n?)+)\\};`;

const SCVR = '[a-zA-Z0-9$_]';
const FNR = `${SCVR}+`;
const AAR = '\\[(\\d+)]';
const N_TRANSFORM_NAME_REGEXPS = [
    // NewPipeExtractor regexps
    `${SCVR}+="nn"\\[\\+${
        SCVR}+\\.${SCVR}+],${
        SCVR}+=${SCVR
    }+\\.get\\(${SCVR}+\\)\\)&&\\(${
        SCVR}+=(${SCVR
    }+)\\[(\\d+)]`,
    `${SCVR}+="nn"\\[\\+${
        SCVR}+\\.${SCVR}+],${
        SCVR}+=${SCVR}+\\.get\\(${
        SCVR}+\\)\\).+\\|\\|(${SCVR
    }+)\\(""\\)`,
    `\\(${SCVR}=String\\.fromCharCode\\(110\\),${
        SCVR}=${SCVR}\\.get\\(${
        SCVR}\\)\\)&&\\(${SCVR
    }=(${FNR})(?:${AAR})?\\(${
        SCVR}\\)`,
    `\\.get\\("n"\\)\\)&&\\(${SCVR
    }=(${FNR})(?:${AAR})?\\(${
        SCVR}\\)`,
    // Skick regexps
    '(\\w+).length\\|\\|\\w+\\(""\\)',
    '\\w+.length\\|\\|(\\w+)\\(""\\)',
];

// LavaPlayer regexps
const N_TRANSFORM_REGEXP = 'function\\(\\s*(\\w+)\\s*\\)\\s*\\{' +
    'var\\s*(\\w+)=(?:\\1\\.split\\(""\\)|String\\.prototype\\.split\\.call\\(\\1,""\\)),' +
    '\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]' +
    '(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\' +
    '{\\s*return"enhanced_except_([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,""\\))};';

const DECIPHER_ARGUMENT = 'sig';
const N_ARGUMENT = 'ncode';

/**
 * @author SNIPPIK
 * @description Парсим страницу для получения данных с youtube
 * @class Signature_Extractor
 */
class Signature_Extractor {
    /**
     * @description Применяем преобразования decipher и n параметров ко всем URL-адресам формата.
     * @param formats - Все форматы аудио или видео
     * @param html5player - Ссылка на плеер
     */
    public static decipherFormats = async (formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat[]> =>  {
        const [decipherScript, nTransformScript] = await this.extractPage(html5player);

        for (let item of formats) item.url = this.setDownloadURL(item, {decipher: decipherScript, nTransform: nTransformScript});
        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     */
    private static setDownloadURL = (format: YouTubeFormat, script: {decipher?: Script, nTransform?: Script}): string => {
        const url = format.url || format.signatureCipher || format.cipher, {decipher, nTransform} = script;
        const extractDecipher = (url: string): string => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url as string;

            const components = new URL(decodeURIComponent(args.url as string));
            components.searchParams.set(args.sp as string ? args.sp as string : DECIPHER_ARGUMENT, decipher.runInNewContext({sig: decodeURIComponent(args.s as string)}));
            return components.toString();
        };
        const extractN = (url: string): string => {
            const components = new URL(decodeURIComponent(url));
            const n = components.searchParams.get("n");
            if (!n || !nTransform) return url;
            components.searchParams.set("n", nTransform.runInNewContext({ncode: n}));
            return components.toString();
        };

        //Удаляем не нужные данные
        delete format.signatureCipher;
        delete format.cipher;

        return !format.url ? extractN(extractDecipher(url)) : extractN(url);
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param html5 - Ссылка на плеер
     */
    private static extractPage = async (html5: string) => {
        const body = await new httpsClient(html5).toString;

        if (body instanceof Error) return null;
        return [
            this.extraction([extractors[1].callback, extractors[0].callback], body),
            this.extraction([extractors[2].callback, extractors[3].callback], body)
        ];
    };

    /**
     * @description Получаем функции для расшифровки
     * @param functions -
     * @param body - Станица youtube
     */
    private static extraction = (functions: Function[], body: string) => {
        for (const callback of functions) {
            try {
                const func = callback(body);
                if (!func) continue;
                return new Script(func);
            } catch (err) {}
        }
        return null;
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({cAPI});