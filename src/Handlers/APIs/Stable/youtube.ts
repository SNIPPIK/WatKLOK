import {Song} from "@watklok/player/queue/Song";
import {httpsClient} from "@watklok/request";
import {API, Constructor} from "@handler";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
class YouTubeAPI extends Constructor.Assign<API.request> {
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
                            callback: (url: string) => {
                                const ID = /[a-zA-Z0-9-_]{11}/.exec(url);

                                return new Promise<Song>(async (resolve, reject) => {
                                    //Если ID видео не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const result = await YouTubeLib.API(`https://www.youtube.com/watch?v=${ID}&has_verified=1`);

                                        //Если возникла ошибка при получении данных
                                        if (result instanceof Error) return reject(result);

                                        const format = await YouTubeLib.extractStreamingData(result["streamingData"], result["html5"]);

                                        result["videoDetails"]["format"] = {url: format.url};

                                        return resolve(YouTubeLib.track(result["videoDetails"]));
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
                            callback: (url: string) => {
                                const ID = url.match(this.filter);
                                let author = null;

                                return new Promise<Song.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const details = await YouTubeLib.API(`https://www.youtube.com/${ID.pop()}`);

                                        if (details instanceof Error) return reject(details);

                                        const sidebar: any[] = details["sidebar"]["playlistSidebarRenderer"]["items"];
                                        const microformat: any = details["microformat"]["microformatDataRenderer"];
                                        const items: Song[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                            .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"]
                                            .splice(0, env.get("APIs.limit.playlist")).map(({playlistVideoRenderer}) => YouTubeLib.track(playlistVideoRenderer));

                                        //Если нет автора плейлиста то это альбом автора
                                        if (sidebar.length > 1) {
                                            const authorData = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                                            author = await YouTubeLib.getChannel({ id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"], name: authorData.title["runs"][0].text });
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
                            callback: (url: string) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        let ID: string;

                                        if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                                        else ID = `channel/${url.split("channel/")[1]}`;

                                        //Создаем запрос
                                        const details = await YouTubeLib.API(`https://www.youtube.com/${ID}/videos`);

                                        if (details instanceof Error) return reject(details);

                                        const author = details["microformat"]["microformatDataRenderer"];
                                        const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                                        const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                                            ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, env.get("APIs.limit.author"));

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
                            callback: (url: string) => {
                                return new Promise<Song[]>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const details = await YouTubeLib.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                        //Если при получении данных возникла ошибка
                                        if (details instanceof Error) return reject(details);

                                        let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                        if (vanilla_videos?.length === 0 || !vanilla_videos) return reject(Error(`[APIs]: Не удалось найти: ${url}`));

                                        let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, env.get("APIs.limit.search"));
                                        let videos = filtered_.map(({ videoRenderer }: any) => YouTubeLib.track(videoRenderer));

                                        return resolve(videos);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        })
                    };
                },
            ]
        });
    };
}

export default Object.values({YouTubeAPI});


/**
 * @author SNIPPIK
 * @class YouTubeLib
 */
class YouTubeLib {
    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url {string} Ссылка на видео
     */
    public static API = (url: string): Promise<Error | any> => {
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

                data["html5"] = `https://www.youtube.com${api.split('"jsUrl":"')[1].split('"')[0]}`;
                return resolve(data);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем данные из страницы
     * @param input {string} Страница
     */
    public static extractInitialDataResponse = (input: string): any | Error | null => {
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
    public static extractStreamingData = (data: any, html5player: string): Promise<YouTubeFormat> => {
        return new Promise(async (resolve) => {
            const format = data["adaptiveFormats"].filter((item: YouTubeFormat) => item.mimeType.match(/opus/) || item.mimeType.match(/audio/));

            return resolve(await new DecodeVideos({html: html5player, format: format?.pop()}).extract);
        });
    };

    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    public static getChannel = ({ id, name }: { id: string, name?: string }): Promise<Song.author> => {
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
    public static track(track: any): any {
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
 * @description Строчки для расшифровки
 */
class DecodeRegex {
    /**
     * @description Как найти var
     */
    public get var() { return `[a-zA-Z_\\$]\\w*`; };

    /**
     * @description Как найти single
     */
    public get single() { return `'[^'\\\\]*(:?\\\\[\\s\\S][^'\\\\]*)*'`; };

    /**
     * @description Как найти duo
     */
    public get duo() { return `"[^"\\\\]*(:?\\\\[\\s\\S][^"\\\\]*)*"`; };

    /**
     * @description Как найти empty
     */
    public get empty() { return `(?:''|"")`; };

    /**
     * @description Как найти reverse
     */
    public get reverse() { return ':function\\(a\\)\\{' + '(?:return )?a\\.reverse\\(\\)' + '\\}'; };

    public get Regs() {
        return {
            reverse: this.regexp(`(?:^|,)(${this.key})${this.reverse}`),
            slice:   this.regexp(`(?:^|,)(${this.key})${this.slice}`),
            splice:  this.regexp(`(?:^|,)(${this.key})${this.splice}`),
            swap:    this.regexp(`(?:^|,)(${this.key})${this.swap}`)
        };
    };

    /**
     * @description Как найти slice
     */
    public get slice() { return ':function\\(a,b\\)\\{' + 'return a\\.slice\\(b\\)' + '\\}'; };

    /**
     * @description Как найти splice
     */
    public get splice() { return ':function\\(a,b\\)\\{' + 'a\\.splice\\(0,b\\)' + '\\}'; };

    /**
     * @description Как найти swap
     */
    public get swap() {
        return ':function\\(a,b\\)\\{' +
            'var c=a\\[0\\];a\\[0\\]=a\\[b(?:%a\\.length)?\\];a\\[b(?:%a\\.length)?\\]=c(?:;return a)?' +
            '\\}'
    };


    public get quote() {
        return `(?:${this.single}|${this.duo})`;
    };

    public get prop() {
        return `(?:\\.${this.var}|\\[${this.quote}\\])`;
    };

    public get key() {
        return `(?:${this.var}|${this.quote})`
    };

    public get object() {
        const key = this.key;

        return this.regexp(`var (${this.var})=\\{((?:(?:${key}${this.reverse}|${key}${this.slice}|${key}${this.splice}|${key}${this.swap}),?\\r?\\n?)+)};`)
    };

    public get function() {
        return this.regexp(
            `${`function(?: ${this.var})?\\(a\\)\\{` + `a=a\\.split\\(${this.empty}\\);\\s*` + `((?:(?:a=)?${this.var}`
            }${this.prop}\\(a,\\d+\\);)+)` +
            `return a\\.join\\(${this.empty}\\)` +
            `\\}`
        );
    };

    protected readonly regexp = (pattern: string) => new RegExp(pattern, "m");
}


/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на youtube videos
 */
class DecodeVideos {
    private readonly _local = {
        format: null as YouTubeFormat,
        decoder: new DecodeRegex(),
        html: null as string,

        body: null as string
    };

    public constructor(options: { html: string; format: YouTubeFormat }) {
        Object.assign(this._local, options);
    };

    /**
     * @description Получаем исходную ссылку на файл
     * @public
     */
    public get extract() {
        return new Promise<YouTubeFormat>(async (resolve) => {
            new httpsClient(this._local.html).toString.then((page) => {
                if (page instanceof Error) return resolve(null);

                this._local.body = page;
                const url = this.url;

                if (url) this._local.format.url = url;
                return resolve(this._local.format);
            });
        });
    }

    /**
     * @description Берем данные с youtube html5player
     * @private
     */
    private get parseTokens(): string[] {
        const funAction = this._local.decoder.function.exec(this._local.body);
        const objAction = this._local.decoder.object.exec(this._local.body);

        if (!funAction || !objAction) return null;

        const object = objAction.at(1)?.replace(/\$/g, "\\$");
        const objPage = objAction.at(2)?.replace(/\$/g, "\\$");
        const funPage = funAction.at(1)?.replace(/\$/g, "\\$");

        let result: RegExpExecArray, tokens: string[] = [], keys: string[] = [];
        for (const decoder of Object.values(this._local.decoder.Regs)) {
            result = decoder.exec(objPage);
            keys.push(this.replacer(result));
        }

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
     * @description Получаем ссылку на файл
     * @private
     */
    private get url() {
        const tokens = this.parseTokens;
        const cipher = this._local.format.signatureCipher || this._local.format.cipher;

        if (cipher) {
            const params = Object.fromEntries(new URLSearchParams(cipher));
            Object.assign(this._local.format, params);
            delete this._local.format.signatureCipher;
            delete this._local.format.cipher;
        }

        if (tokens && this._local.format.s && this._local.format.url) {
            const signature = this.DecodeSignature(tokens, this._local.format.s);
            const Url = new URL(decodeURIComponent(this._local.format.url));
            Url.searchParams.set('ratebypass', 'yes');

            if (signature) Url.searchParams.set(this._local.format.sp || 'signature', signature);

            return Url.toString();
        }

        return null;
    };

    /**
     * @description Проводим некоторые манипуляции с signature
     * @param tokens {string[]}
     * @param signature {string}
     * @private
     */
    private DecodeSignature = (tokens: string[], signature: string): string => {
        let sig = signature.split(""), position: any;

        for (const token of tokens) {
            const nameToken = token.slice(2);

            switch (token.slice(0, 2)) {
                case "sw": { position = parseInt(nameToken); swapPositions<string>(sig, position); break; }
                case "sl": { position = parseInt(nameToken); sig = sig.slice(position); break; }
                case "sp": { position = parseInt(nameToken); sig.splice(0, position); break; }
                case "rv": { sig.reverse(); break; }
            }
        }
        return sig.join("");
    };

    /**
     * @description Уменьшаем кол-во кода
     * @param res {RegExpExecArray}
     * @private
     */
    private replacer = (res: RegExpExecArray): string => res && res.at(1)?.replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");
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