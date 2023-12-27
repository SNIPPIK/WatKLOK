import {Song} from "@components/AudioClient/Queue/Song";
import {httpsClient} from "@components/Request";
import {API} from "@handler/APIs";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @class initYouTube
 * @description Динамически загружаемый класс
 */
export default class implements API.load {
    public readonly name = "YOUTUBE";
    public readonly audio = true;
    public readonly auth = false;
    public readonly prefix = ["yt"];
    public readonly color = 16711680;
    public readonly filter = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
    public readonly url = "youtube.com";
    public readonly requests = [
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение видео
         */
        new class extends YouTubeLib implements API.track {
            public readonly type = "track";
            public readonly filter = /(watch|embed|youtu\.be)/gi;

            public readonly callback = (url: string) => {
                const ID = this._getID(url);

                return new Promise<Song>(async (resolve, reject) => {
                    //Если ID видео не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                    try {
                        //Создаем запрос
                        const result = await this._API(`https://www.youtube.com/watch?v=${ID}&has_verified=1`);

                        //Если возникла ошибка при получении данных
                        if (result instanceof Error) return reject(result);

                        const format = await this._extractStreamingData(result["streamingData"], result["html5"]);

                        result["videoDetails"]["format"] = {url: format.url};

                        return resolve(await this._track(result["videoDetails"], false));
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение плейлиста с видео
         */
        new class extends YouTubeLib implements API.list {
            public readonly type = "playlist";
            public readonly filter = /playlist\?list=/gi;

            public readonly callback = (url: string) => {
                const ID = this._getID(url, true);

                return new Promise<Song.playlist>(async (resolve, reject) => {
                    //Если ID плейлиста не удалось извлечь из ссылки
                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

                    try {
                        //Создаем запрос
                        const details = await this._API(`https://www.youtube.com/playlist?list=${ID}`);

                        if (details instanceof Error) return reject(details);

                        const info = details["sidebar"]["playlistSidebarRenderer"].items[0]["playlistSidebarPrimaryInfoRenderer"];
                        const author = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                        const contents: any[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"].content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"].splice(0, env.get("APIs.limit.playlist"));

                        //Модифицируем видео
                        const videos = contents.map(({playlistVideoRenderer}) => this._track(playlistVideoRenderer, true));

                        return resolve({
                            title: info.title["runs"][0].text, url,
                            items: videos,
                            author: await this._getChannel({ id: author["navigationEndpoint"]["browseEndpoint"]["browseId"], name: author.title["runs"][0].text }),
                            image: info["thumbnailRenderer"]["playlistVideoThumbnailRenderer"].thumbnail["thumbnails"].pop()
                        });
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Поиск видео
         */
        new class extends YouTubeLib implements API.array {
            public readonly type = "search";

            public readonly callback = (search: string) => {
                return new Promise<Song[]>(async (resolve, reject) => {
                    try {
                        //Создаем запрос
                        const details = await this._API(`https://www.youtube.com/results?search_query=${search.split(" ").join("+")}`);

                        //Если при получении данных возникла ошибка
                        if (details instanceof Error) return reject(details);

                        let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                        if (vanilla_videos?.length === 0 || !vanilla_videos) return reject(Error(`[APIs]: Не удалось найти: ${search}`));

                        let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, env.get("APIs.limit.search"));
                        let videos = filtered_.map(({ videoRenderer }: any) => this._track(videoRenderer, true));

                        return resolve(videos);
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        },
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение последних видео автора
         */
        new class extends YouTubeLib implements API.array {
            public readonly type = "artist";
            public readonly filter = /(channel)/gi || /@/gi;

            public callback = (url: string) => {
                return new Promise<Song[]>(async (resolve, reject) => {
                    try {
                        let ID: string;

                        if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                        else ID = `channel/${url.split("channel/")[1]}`;

                        //Создаем запрос
                        const details = await this._API(`https://www.youtube.com/${ID}/videos`);

                        if (details instanceof Error) return reject(details);

                        const author = details["microformat"]["microformatDataRenderer"];
                        const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                        const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                            ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, env.get("APIs.limit.author"));

                        //Модифицируем видео
                        const videos = contents.map(({richItemRenderer}: any) => {
                            const video = richItemRenderer?.content?.["videoRenderer"];

                            return {
                                url: `https://youtu.be/${video["videoId"]}`, title: video.title["runs"][0].text, duration: { seconds: video["lengthText"]["simpleText"] },
                                author: { url: `https://www.youtube.com${ID}`, title: author.title }
                            }
                        });

                        return resolve(videos);
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            };
        }
    ];
}



/**
 * @author SNIPPIK
 * @class YouTubeLib
 */
class YouTubeLib {
    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url {string} Ссылка на видео
     */
    protected _API = (url: string): Promise<Error | any> => {
        return new Promise((resolve) => {
            new httpsClient(url, {cookie: true, useragent: true,
                headers: { "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7", "accept-encoding": "gzip, deflate, br" }
            }).toString.then((api) => {
                //Если возникает ошибка при получении страницы
                if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                //Ищем данные на странице
                const data = this._extractInitialDataResponse(api);

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
    private _extractInitialDataResponse = (input: string): any | Error | null => {
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
    protected _extractStreamingData = async (data: any, html5player: string): Promise<YouTubeFormat> => {
        let videos: YouTubeFormat[] = [];

        for (const item of data["adaptiveFormats"]) {
            if (item.mimeType.match(/opus/) || item.mimeType.match(/audio/)) {
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
    protected _getID = (url: string, isPlaylist: boolean = false): string => {
        try {
            if (typeof url !== "string") return null;
            const parsedLink = new URL(url);

            if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
            else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
            else if (url.match(/shorts/)) return parsedLink.pathname.split("/").pop();
            else if (url.match(/si=/)) return parsedLink.pathname.split("/")[1].split("si=")[0];
            else return parsedLink.pathname.split("/")[1];
        } catch (err) { return null; }
    };


    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    protected _getChannel = ({ id, name }: { id: string, name?: string }): Promise<Song.author> => {
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
     * @param sync
     */
    protected _track(track: any, sync: true): Song;
    protected _track(track: any, sync: false): Promise<Song>;
    protected _track(track: any, sync: any): any {
        if (sync) return new Song({
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
        });

        return new Promise(async (resolve) => {
            return resolve(new Song({
                author: await this._getChannel({id: track.channelId, name: track.author}),
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title,
                duration: {seconds: track["lengthSeconds"] ?? 0},
                image: track.thumbnail["thumbnails"].pop(),
                isLive: track["isLiveContent"],
                format: track?.format || undefined
            }));
        });
    };
}


/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок youtube
 */
const js = {
    var: '[a-zA-Z_\\$]\\w*',
    single: `'[^'\\\\]*(:?\\\\[\\s\\S][^'\\\\]*)*'`,
    duo: `"[^"\\\\]*(:?\\\\[\\s\\S][^"\\\\]*)*"`,
    empty: `(?:''|"")`,

    reverse: ':function\\(a\\)\\{' + '(?:return )?a\\.reverse\\(\\)' + '\\}',
    slice: ':function\\(a,b\\)\\{' + 'return a\\.slice\\(b\\)' + '\\}',
    splice: ':function\\(a,b\\)\\{' + 'a\\.splice\\(0,b\\)' + '\\}',
    swap: ':function\\(a,b\\)\\{' +
        'var c=a\\[0\\];a\\[0\\]=a\\[b(?:%a\\.length)?\\];a\\[b(?:%a\\.length)?\\]=c(?:;return a)?' +
        '\\}'
}
const quote = `(?:${js.single}|${js.duo})`;
const prop = `(?:\\.${js.var}|\\[${quote}\\])`;
const key = `(?:${js.var}|${quote})`;
const regExp = {
    reverse: new RegExp(`(?:^|,)(${key})${js.reverse}`, 'm'),
    slice: new RegExp(`(?:^|,)(${key})${js.slice}`, 'm'),
    splice: new RegExp(`(?:^|,)(${key})${js.splice}`, 'm'),
    swap: new RegExp(`(?:^|,)(${key})${js.swap}`, 'm'),


    obj: new RegExp(`var (${js.var})=\\{((?:(?:${key}${js.reverse}|${key}${js.slice}|${key}${js.splice}|${key}${js.swap}),?\\r?\\n?)+)};`),
    function: new RegExp(
        `${`function(?: ${js.var})?\\(a\\)\\{` + `a=a\\.split\\(${js.empty}\\);\\s*` + `((?:(?:a=)?${js.var}`
        }${prop}\\(a,\\d+\\);)+)` +
        `return a\\.join\\(${js.empty}\\)` +
        `\\}`
    )
}

interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
}

/**
 * @description Применяет преобразование параметра расшифровки и n ко всем URL-адресам формата.
 * @param {Array.<Object>} format
 * @param {string} html5player
 */
function extractSignature(format: YouTubeFormat, html5player: string): Promise<YouTubeFormat> {
    return new Promise<YouTubeFormat>((resolve) => {
        new httpsClient(html5player).toString.then((page: string) => {
            const tokens = parseTokens(page);
            const url = setDownload(format, tokens);

            if (url) format.url = url;

            return resolve(format);
        });
    });
}

/**
 * @description Проводим некоторые манипуляции с signature
 * @param tokens {string[]}
 * @param signature {string}
 */
function DecodeSignature(tokens: string[], signature: string): string {
    let sig = signature.split("");

    for (const token of tokens) {
        let position;
        const nameToken = token.slice(2);

        switch (token.slice(0, 2)) {
            case "sw": { position = parseInt(nameToken); swapPositions<string>(sig, position); break; }
            case "sl": { position = parseInt(nameToken); sig = sig.slice(position); break; }
            case "sp": { position = parseInt(nameToken); sig.splice(0, position); break; }
            case "rv": { sig.reverse(); break; }
        }
    }
    return sig.join("");
}

/**
 * @description Берем данные с youtube html5player
 * @param page {string} Страница html5player
 */
function parseTokens(page: string): string[] {
    const funAction = regExp.function.exec(page);
    const objAction = regExp.obj.exec(page);

    if (!funAction || !objAction) return null;

    const object = objAction[1].replace(/\$/g, "\\$");
    const objPage = objAction[2].replace(/\$/g, "\\$");
    const funPage = funAction[1].replace(/\$/g, "\\$");

    let result: RegExpExecArray, tokens: string[] = [], keys: string[] = [];

    [regExp.reverse, regExp.slice, regExp.splice, regExp.swap].forEach((res) => {
        result = res.exec(objPage);
        keys.push(replacer(result));
    });

    const parsedKeys = `(${keys.join('|')})`;
    const tokenizeRegexp = new RegExp(`(?:a=)?${object}(?:\\.${parsedKeys}|\\['${parsedKeys}'\\]|\\["${parsedKeys}"\\])` + `\\(a,(\\d+)\\)`, 'g');

    while ((result = tokenizeRegexp.exec(funPage)) !== null) {
        (() => {
            const key = result[1] || result[2] || result[3];
            switch (key) {
                case keys[0]: return tokens.push('rv');
                case keys[1]: return tokens.push(`sl${result[4]}`);
                case keys[2]: return tokens.push(`sp${result[4]}`);
                case keys[3]: return tokens.push(`sw${result[4]}`);
            }
        })();
    }

    return tokens;
}

/**
 * @description Уменьшаем кол-во кода
 * @param res {RegExpExecArray}
 */
function replacer(res: RegExpExecArray): string {
    return res && res[1].replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");
}

/**
 * @description Изменяем ссылки
 * @param format {YouTubeFormat} Формат youtube
 * @param tokens {RegExpExecArray} Токены
 */
function setDownload(format: YouTubeFormat, tokens: string[]): string {
    const cipher = format.signatureCipher || format.cipher;

    if (cipher) {
        const params = Object.fromEntries(new URLSearchParams(cipher));
        Object.assign(format, params);
        delete format.signatureCipher;
        delete format.cipher;
    }

    if (tokens && format.s && format.url) {
        const signature = DecodeSignature(tokens, format.s);
        const Url = new URL(decodeURIComponent(format.url));
        Url.searchParams.set('ratebypass', 'yes');

        if (signature) Url.searchParams.set(format.sp || 'signature', signature);

        return Url.toString();
    }

    return null;
}

/**
 * @description Смена позиции в Array
 * @param array {Array<any>} Array
 * @param position {number} Номер позиции
 */
function swapPositions<V>(array: V[], position: number): void {
    const first = array[0];
    array[0] = array[position];
    array[position] = first;
}