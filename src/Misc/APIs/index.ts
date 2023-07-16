import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {Duration} from "@Util/Duration";
import {Colors} from "discord.js";

export { Platform, platform, callback };

const Platforms: { audio: platform[], auth: platform[], all: platformData[] } = {
    //Платформы у которых нет возможности получить доступ к аудио
    audio: [],

    //Платформы у которых нет данных авторизации
    auth: [],

    //Доступные платформы, запросы буду загружены позже
    all: [
        {
            requests: [],
            name: "YOUTUBE",
            audio: true,
            color: 16711680,
            prefix: ["yt", "ytb"],
            filter: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi
        },
        {
            requests: [],
            name: "SPOTIFY",
            audio: false,
            color: 1420288,
            prefix: ["sp"],
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi
        },
        {
            requests: [],
            name: "VK",
            audio: true,
            color: 30719,
            prefix: ["vk"],
            filter: /^(https?:\/\/)?(vk\.com)\/.+$/gi
        },
        {
            requests: [],
            name: "YANDEX",
            audio: true,
            color: Colors.Yellow,
            prefix: ["ym", "yandex", "y"],
            filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi
        },
        {
            requests: [],
            name: "DISCORD",
            audio: true,
            color: Colors.Grey,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi
        }
    ]
}

class Platform {
    protected readonly _platform: platform;

    /**
     * @description Передаем полностью Platforms
     */
    public static get Platforms() { return Platforms; };

    /**
     * @description Получаем все запросы от this._platform
     */
    public get requests() { return Platforms.all.find((info) => info.name === this.platform).requests; };

    /**
     * @description Доступна ли музыка у текущей платформы
     */
    public get audio() { return Platforms.audio.includes(this._platform); };

    /**
     * @description Проверяем есть ли данные авторизации у текущей платформы
     */
    public get auth() { return Platforms.auth.includes(this._platform); };

    /**
     * @description Получаем текущую платформу
     */
    public get platform(): platform { return this._platform; };

    /**
     * @description Получаем цвет платформы
     */
    public get color(): number { return Platforms.all.find((pl) => pl.name === this.platform).color; };


    /**
     * @description Получаем или ищем платформу
     * @param string
     */
    public constructor(string: platform | string) {
        try {
            if (string.startsWith("http")) {
                const platforms = Platforms.all.filter((info) => string.match(info.filter));

                //Если нет платформы в базе
                if (!platforms.length) return undefined;

                this._platform = platforms[0].name
            } else {
                const platform = Platforms.all.find((info) => info.name === string || info.prefix && info.prefix.includes(string.split(' ')[0].toLowerCase()));

                if (!platform) this._platform = "YOUTUBE";
                else this._platform = platform.name;
            }
        } catch { this._platform = "YOUTUBE"; }
    };


    /**
     * @description Получаем тип запроса
     * @param url {string} Ссылка
     */
    public type = (url: string): callback => {
        if (!url.startsWith("http")) return "search";

        const Platform = Platforms.all.find((plt) => plt.name === this.platform);
        const type = Platform.requests.find((data) => data.filter && url.match(data.filter));

        if (!type) return undefined;

        return type.type;
    };


    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {callback} Тип запроса
     */
    public callback = (type: callback) => {
        const callback = this.requests.find((data) => data.type === type);

        if (!callback) return null;

        return callback.callback;
    };


    /**
     * @description Получаем аргумент для Platform<callbacks>
     * @param arg {string} Аргумент пользователя
     */
    public filterArgument = (arg: string) => {
        if (!arg || arg.startsWith("http")) return arg;

        const Args = arg.split(" ");

        if (this.platform && Args.length > 1) {
            Args.splice(0, 1);

            return Args.join(" ");
        }

        return arg;
    };


    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    public static resource = ({ platform, url, author, title, duration }: Song): Promise<string> => {
        if (!Platforms.audio.includes(platform)) {
            const callback = new Platform(platform).callback("track");

            //Если нет такой платформы или нет callbacks.track
            if (typeof callback === "string") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<ISong.track>).then((track: ISong.track) => track?.format?.url);
        }
        //Ищем трек
        let track = this.searchTrack(`${author.title} ${title}`, duration.seconds, platform);

        //Если трек не найден пробуем 2 вариант без автора
        if (!track) track = this.searchTrack(title, duration.seconds, platform);

        return track;
    };


    /**
     * @description Ищем трек на yandex music, если нет токена yandex music или yandex не дал ссылку то ищем на YouTube
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @param platform {platform} Платформа
     */
    protected static searchTrack = (nameSong: string, duration: number, platform: platform): Promise<string> => {
        const exPlatform = Platforms.auth.includes(platform) || Platforms.audio.includes(platform) ? Platforms.auth.includes("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const callbacks = new Platform(exPlatform).requests;

        const search = callbacks.find((req) => req.type === "search");
        const track = callbacks.find((req) => req.type === "track");

        return (search.callback(nameSong) as Promise<ISong.track[]>).then((tracks: ISong.track[]) => {
            //Фильтруем треки оп времени
            const FindTracks: ISong.track[] = tracks.filter((track: ISong.track) => {
                const DurationSong: number = (exPlatform === "YOUTUBE" ? Duration.toConverting : parseInt)(track.duration.seconds) as number;

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return (track.callback(FindTracks[0].url) as Promise<ISong.track>).then((video: ISong.track) => video?.format?.url) as Promise<string>;
        });
    };
}



//Поддерживаемые платформы
type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";

//Поддерживаемые типы для этих платформ
type callback = "track" | "playlist" | "search" | "album" | "artist";

//Данные которые хранит Platforms.all в формате Array
interface platformData {
    //Название платформы
    name: platform;

    //Возможно ли получить исходный файл трека
    audio: boolean;

    //Цвет платформы
    color: number;

    //Названия для поиска
    prefix?: string[];

    //Проверка ссылки
    filter: RegExp;

    //Допустимые запросы
    requests: (API.list | API.array | API.track)[];
}

export namespace API {
    export interface track {
        filter: RegExp;
        type: "track";
        callback: (url: string) => Promise<ISong.track | Error>;
    }

    export interface array {
        filter?: RegExp;
        type: "search" | "artist";
        callback: (url: string) => Promise<ISong.track[] | Error>;
    }

    export interface list {
        filter: RegExp;
        type: "playlist" | "album";
        callback: (url: string) => Promise<ISong.playlist | Error>;
    }
}