import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {Duration} from "@Util/Duration";
import {Colors} from "discord.js";

export { APIs, platform, callback };

//Поддерживаемые платформы
type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";

//Поддерживаемые типы для этих платформ
type callback = "track" | "playlist" | "search" | "album" | "artist";

/**
 * @description База с платформами для взаимодействия
 * @global
 */
const SupportedPlatforms: {
    requests: (API.list | API.array | API.track)[]; name: platform;
    audio: boolean;                                 auth: boolean;
    prefix?: string[];                              color: number;
    filter: RegExp;
}[] = [
    {
        requests: [],                  name: "YOUTUBE",
        audio: true,                   auth: false,
        prefix: ["yt", "ytb"],         color: 16711680,
        filter: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi
    },
    {
        requests: [],                  name: "SPOTIFY",
        audio: false,                  auth: true,
        prefix: ["sp"],                color: 1420288,
        filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi
    },
    {
        requests: [],                  name: "VK",
        audio: true,                   auth: true,
        prefix: ["vk"],                color: 30719,
        filter: /^(https?:\/\/)?(vk\.com)\/.+$/gi
    },
    {
        requests: [],                  name: "YANDEX",
        audio: true,                   auth: true,
        prefix: ["ym", "yandex", "y"], color: Colors.Yellow,
        filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi
    },
    {
        requests: [],                  name: "DISCORD",
        audio: true,                   auth: false,
        color: Colors.Grey,
        filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi
    }
];

/**
 * @description База с платформами если нет данных для авторизации
 */
const AuthorizationPlatforms: platform[] = [];

/**
 * @description База с названиями платформ у которых нет доступа к получению аудио
 */
const AudioPlatforms: platform[] = [];

/**
 * @description Главный класс
 */
class initPlatform {
    protected readonly _platform: platform = null;
    /**
     * @description Ищем платформу в базе
     */
    private find = (callback: (d: any) => boolean) => SupportedPlatforms.find(callback);

    /**
     * @description Получаем все запросы от this._platform
     */
    public get requests() { return SupportedPlatforms.find((info) => info.name === this._platform).requests; };

    /**
     * @description Доступна ли музыка у текущей платформы
     */
    public get audio() { return AudioPlatforms.includes(this._platform); };

    /**
     * @description Проверяем есть ли данные авторизации у текущей платформы
     */
    public get auth() { return AuthorizationPlatforms.includes(this._platform); };

    /**
     * @description Получаем текущую платформу
     */
    public get platform(): platform { return this._platform; };

    /**
     * @description Получаем цвет платформы
     */
    public get color(): number { return SupportedPlatforms.find((pl) => pl.name === this.platform).color; };

    public constructor(argument: string | platform) {
        let platform;

        try {
            //Следуя какой аргумент ищем платформу
            if (argument.startsWith("http")) platform = this.find((info) => !!argument.match(info.filter));
            else platform = this.find((info) => info.name === argument || info.prefix && info.prefix.includes(argument.split(' ')[0].toLowerCase()));

            //Если найти не удалось значит ставим YouTube
            if (!platform) this._platform = "YOUTUBE";
            else this._platform = platform.name;
        } catch { this._platform = "YOUTUBE" }
    };
}

/**
 * @description Отвечает за поиск исходного файл музыки
 */
class Finder extends initPlatform {
    /**
     * @description Передаем полностью SupportedPlatforms
     */
    public static get Platforms() { return SupportedPlatforms; };

    /**
     * @description Передаем полностью AudioPlatforms
     */
    public static get Audios() { return AudioPlatforms; };

    /**
     * @description Передаем полностью AuthorizationPlatforms
     */
    public static get Auths() { return AuthorizationPlatforms; };

    /**
     * @description Получаем случайную платформу
     */
    private static get randomPlatform() {
        const filter = SupportedPlatforms.filter((platform) =>
            !AudioPlatforms.includes(platform.name) && !AuthorizationPlatforms.includes(platform.name)
        );

        return filter[Duration.randomNumber(filter.length)];
    };


    /**
     * @description Получаем исходный файл музыки
     */
    public static resource = ({ platform, url, author, title, duration }: Song): Promise<string> => {
        if (AudioPlatforms.includes(platform)) {
            let track = this.searchTrack(`${author.title} ${title}`, duration.seconds);
            if (!track) track = this.searchTrack(`${title}`, duration.seconds);

            return track;
        }

        const callback = new APIs(platform).callback("track");

        //Если нет такого запроса
        if (!callback) return null;

        return (callback(url) as Promise<ISong.track>).then((track) => track.format.url);
    };


    /**
     * @description Если у платформы нет возможности дать исходный файл то ищем его на других платформах
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     */
    private static searchTrack = async (nameSong: string, duration: number): Promise<string> => {
        const randomPlatform = this.randomPlatform;
        const track = randomPlatform.requests.find((d) => d.type === "track");
        const search = randomPlatform.requests.find((d) => d.type === "search");

        //Ищем треки
        const tracks = await search.callback(nameSong) as ISong.track[] | Error;

        //Если поиск выдал ошибку или нет треков возвращаем ничего
        if (tracks instanceof Error || tracks.length === 0) return null;

        //Ищем подходящие треки
        const GoodTracks = tracks.filter((track) => {
            const DurationSong: number = (randomPlatform.name === "YOUTUBE" ? Duration.toConverting : parseInt)(track.duration.seconds) as number;

            //Как надо фильтровать треки
            return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
        });

        //Если подходящих треков нет, то возвращаем ничего
        if (GoodTracks.length === 0) return null;

        //Делаем запрос полной информации о треки для получения ссылки на исходный файл музыки
        return track.callback(GoodTracks[0].url).then((track: any) => track.format.url);
    };
}

/**
 * @description Отвечает за мелкие функции с возвращением данных
 */
class APIs extends Finder {
    /**
     * @description Получаем тип запроса
     * @param url {string} Ссылка
     */
    public type = (url: string): callback => {
        if (!url.startsWith("http")) return "search";

        const Platform = SupportedPlatforms.find((plt) => plt.name === this.platform);
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
}


/**
 * @description Для загрузки запросов из файлов
 */
export namespace API {
    /**
     * @description Структура получение трека
     */
    export interface track {
        filter: RegExp;
        type: "track";
        callback: (url: string) => Promise<ISong.track | Error>;
    }

    /**
     * @description Структура получение нескольких объектов
     */
    export interface array {
        filter?: RegExp;
        type: "search" | "artist";
        callback: (url: string) => Promise<ISong.track[] | Error>;
    }

    /**
     * @description Структура объектов и данных об объектах
     */
    export interface list {
        filter: RegExp;
        type: "playlist" | "album";
        callback: (url: string) => Promise<ISong.playlist | Error>;
    }
}