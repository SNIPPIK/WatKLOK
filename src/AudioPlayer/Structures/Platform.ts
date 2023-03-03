import { SoundCloud, Spotify, VK, YandexMusic, YouTube } from "@AudioPlayer/APIs";
import { inPlaylist, inTrack } from "@Queue/Song";
import { FFprobe } from "@Media/FFspace";
import { Music } from "@db/Config.json";
import { Colors } from "discord.js";
import { env } from "@env";

export { Platform, platform, callback };
//====================== ====================== ====================== ======================

//Поддерживаемые платформы
type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";
//Поддерживаемые типы для этих платформ
type callback = "track" | "playlist" | "search" | "album" | "artist";
//Данные которые хранит Platforms.all в формате Array
interface platformData {
    platform: platform;
    color: number;
    prefix?: string[];
    reg: RegExp;

    callbacks: {
        track: (str: string) => Promise<inTrack>,

        search?: (str: string) => Promise<inTrack[]>,
        artist?: (str: string) => Promise<inTrack[]>

        playlist?: (str: string) => Promise<inPlaylist>,
        album?: (str: string) => Promise<inPlaylist>,
    }
}

const Platforms: {noAudio: platform[], noAuth: platform[], all: platformData[]} = {
    //Платформы у которых нет возможности получить доступ к аудио
    noAudio: ["SPOTIFY"],
    //Платформы у которых нет данных авторизации
    noAuth: [],

    //Все возможные запросы данных в JSON формате
    all: [
        { //Какие данные можно взять с YouTube
            platform: "YOUTUBE",
            color: 16711680, //Цвет трека
            prefix: ["yt", "ytb"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track:    YouTube.getVideo,
                search:   YouTube.SearchVideos,
                artist:   YouTube.getChannelVideos,
                playlist: YouTube.getPlaylist
            }
        },
        { //Какие данные можно взять с Spotify
            platform: "SPOTIFY",
            color: 1420288, //Цвет трека
            prefix: ["sp"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track:    Spotify.getTrack,
                album:    Spotify.getAlbum,
                search:   Spotify.SearchTracks,
                artist:   Spotify.getAuthorTracks,
                playlist: Spotify.getPlaylist
            }
        },
        { //Какие данные можно взять с Soundcloud
            platform: "SOUNDCLOUD",
            color: 0xe67e22, //Цвет трека
            prefix: ["sc"], //Префиксы для поиска
            reg: /^(https?:\/\/)?((?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track:    SoundCloud.getTrack,
                search:   SoundCloud.SearchTracks,
                playlist: SoundCloud.getPlaylist,
                album:    SoundCloud.getPlaylist
            }
        },
        { //Какие данные можно взять с VK
            platform: "VK",
            color: 30719, //Цвет трека
            prefix: ["vk"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(vk\.com)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track:    VK.getTrack,
                search:   VK.SearchTracks,
                playlist: VK.getPlaylist
            }
        },
        {  //Какие данные можно взять с Yandex music
            platform: "YANDEX",
            color: Colors.Yellow, //Цвет трека
            prefix: ["ym", "yandex", "y"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track:  YandexMusic.getTrack,
                album:  YandexMusic.getAlbum,
                search: YandexMusic.SearchTracks,
                artist: YandexMusic.getArtistTracks
            }
        },
        { //Какие данные можно взять с Discord
            platform: "DISCORD",
            color: Colors.Grey, //Цвет трека
            reg: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com)\/.+$/gi || /^(http?:\/\/)\/.+$/gi || /^(https?:\/\/)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track: (url: string): Promise<inTrack> => FFprobe(url).then((trackInfo: any) => {
                    //Если не найдена звуковая дорожка
                    if (!trackInfo) return null;

                    return {
                        url, author: null, image: { url: Music.images._image },
                        title: url.split("/").pop(),
                        duration: { seconds: trackInfo.format.duration },
                        format: { url: trackInfo.format.filename }
                    };
                })
            }
        }
    ]
};
//====================== ====================== ====================== ======================
//Проверяем наличие данных авторизации
(() => {
    if (!env.get("SPOTIFY_ID") || !env.get("SPOTIFY_SECRET")) Platforms.noAuth.push("SPOTIFY");
    if (!env.get("VK_TOKEN")) Platforms.noAuth.push("VK");
    if (!env.get("YANDEX")) Platforms.noAuth.push("YANDEX");
})();
//====================== ====================== ====================== ======================

//====================== ====================== ====================== ======================
/*                           Namespace for getting data platforms                          */
//====================== ====================== ====================== ======================
namespace Platform {
    /**
     * @description Получаем платформы с которых невозможно включить треки
     * @param platform {platform} Платформа
     */
    export function noAudio(platform: platform) {
        return Platforms.noAudio.includes(platform);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем цвет платформы
     * @param platform {platform} Платформа
     */
    export function color(platform: platform): number | null {
        const findPlatforms = Platforms.all.find((info) => info.platform === platform);

        if (findPlatforms) return findPlatforms.color;
        return null;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем платформы с которых невозможно включить треки из проблем с авторизацией
     * @param platform {platform} Платформа
     */
    export function isFailed(platform: platform): boolean {
        return Platforms.noAuth.includes(platform);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param platform {platform} Платформа
     * @param type {callback} Тип запроса
     */
    export function callback(platform: platform, type: callback) {
        const findPlatforms = Platforms.all.find((info) => info.platform === platform);

        if (!findPlatforms) return "!platform";

        const callback = findPlatforms.callbacks[type];

        if (!callback) return "!callback";

        return callback;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем тип запроса
     * @param url {string} Ссылка
     */
    export function type(url: string): callback {
        //Если нет str, значит пользователь прикрепил файл
        if (!url) return "track";

        //Если str является ссылкой
        if (url.match(/^(https?:\/\/)/gi)) {
            if (url.match(/playlist/)) return "playlist";
            else if ((url.match(/album/) || url.match(/sets/)) && !url.match(/track/)) return "album";
            else if (url.match(/artist/) || url.match(/channel/) || url.match(/@/)) return "artist";
            return "track";
        }
        return "search";
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем название платформы
     * @param str {string} Название трека или ссылка
     */
    export function name(str: string): platform {
        //Если пользователь ищет трек по ссылке
        if (str.match(/^(https?:\/\/)/gi)) {
            const findPlatform = Platforms.all.filter((info) => str.match(info.reg));

            return findPlatform[0].platform;
        } else { //Если пользователь ищет трек по названию
            const prefixs = str.split(' '), platform = prefixs[0].toLowerCase();
            const findPlatform = Platforms.all.find((info) => info.prefix && info.prefix.includes(platform));

            if (findPlatform) return findPlatform.platform;
            return "YOUTUBE";
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем аргумент для Platform<callbacks>
     * @param str {string} Строка или ссылка
     */
    export function filterArg(str: string) {
        //Если нет search, значит пользователь прикрепил файл
        if (!str || str.match(/^(https?:\/\/)/gi)) return str;

        const ArrayArg = str.split(" ");
        const findPlatform = Platforms.all.find((info) => info.platform === ArrayArg[0].toUpperCase() || info.prefix && info.prefix.includes(ArrayArg[0].toLowerCase()));

        if (findPlatform && ArrayArg.length > 1) {
            ArrayArg.splice(0, 1);

            return ArrayArg.join(" ");
        }

        return str;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем полную информацию о платформе
     * @param platform {platform} Платформа
     */
    export function full(platform: platform) {
        return Platforms.all.find((pl) => pl.platform === platform);
    }
}