import { FFprobe } from "@AudioPlayer/Structures/Media/FFspace";
import { DurationUtils } from "@Utils/Durations";
import { ISong, Song } from "@AudioPlayer/Structures/Song";
import { Music } from "@db/Config.json";
import { Colors } from "discord.js";
import { env } from "@env";

//Supported platforms
import {YouTube} from "src/Structures/APIs/YouTube";
import {Spotify} from "src/Structures/APIs/Spotify";
import {SoundCloud} from "src/Structures/APIs/SoundCloud";
import {VK} from "src/Structures/APIs/VK";
import {YandexMusic} from "src/Structures/APIs/YandexMusic";

export { Platform, platform, callback };

const Platforms: { audio: platform[], auth: platform[], all: platformData[] } = {
    //Платформы у которых нет возможности получить доступ к аудио
    audio: [],

    //Платформы у которых нет данных авторизации
    auth: [],

    //Все возможные запросы данных в JSON формате
    all: [
        { //Какие данные можно взять с YouTube
            requests: [
                {
                    type: "track",
                    filter: /(watch)?(embed)?(be)/gi,
                    run: YouTube.getVideo
                },
                {
                    type: "artist",
                    filter: /(channel)?(@)/gi,
                    run: YouTube.getChannelVideos
                },
                {
                    type: "playlist",
                    filter: /playlist/,
                    run: YouTube.getPlaylist
                },
                {
                    type: "search",
                    run: YouTube.SearchVideos
                }
            ],

            name: "YOUTUBE",
            audio: true,
            color: 16711680,
            prefix: ["yt", "ytb"],
            filter: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi
        },
        { //Какие данные можно взять с Spotify
            requests: [
                {
                    type: "track",
                    filter: /track/,
                    run: Spotify.getTrack
                },
                {
                    type: "artist",
                    filter: /artist/,
                    run: Spotify.getAuthorTracks
                },
                {
                    type: "playlist",
                    filter: /playlist/,
                    run: Spotify.getPlaylist
                },
                {
                    type: "album",
                    filter: /album/,
                    run: Spotify.getAlbum
                },
                {
                    type: "search",
                    run: Spotify.SearchTracks
                }
            ],

            name: "SPOTIFY",
            audio: false,
            color: 1420288,
            prefix: ["sp"],
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi
        },
        { //Какие данные можно взять с Soundcloud
            requests: [
                {
                    type: "track",
                    filter: /(track)/gi,
                    run: SoundCloud.getTrack
                },
                {
                    type: "playlist",
                    filter: /playlist/,
                    run: SoundCloud.getPlaylist
                },
                {
                    type: "album",
                    filter: /(album)?(sets)/gi,
                    run: SoundCloud.getPlaylist
                },
                {
                    type: "search",
                    run: SoundCloud.SearchTracks
                }
            ],

            name: "SOUNDCLOUD",
            audio: true,
            color: 0xe67e22,
            prefix: ["sc"],
            filter: /^(https?:\/\/)?((?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/.+$/gi
        },
        { //Какие данные можно взять с VK
            requests: [
                {
                    type: "track",
                    filter: /audio/,
                    run: VK.getTrack
                },
                {
                    type: "playlist",
                    filter: /playlist/,
                    run: VK.getPlaylist
                },
                {
                    type: "search",
                    run: VK.SearchTracks
                }
            ],

            name: "VK",
            audio: true,
            color: 30719,
            prefix: ["vk"],
            filter: /^(https?:\/\/)?(vk\.com)\/.+$/gi
        },
        {  //Какие данные можно взять с Yandex music
            requests: [
                {
                    type: "track",
                    filter: /album/ && /track/,
                    run: YandexMusic.getTrack
                },
                {
                    type: "artist",
                    filter: /artist/,
                    run: YandexMusic.getArtistTracks
                },
                {
                    type: "album",
                    filter: /album/,
                    run: YandexMusic.getAlbum
                },
                {
                    type: "search",
                    run: YandexMusic.SearchTracks
                }
            ],

            name: "YANDEX",
            audio: true,
            color: Colors.Yellow,
            prefix: ["ym", "yandex", "y"],
            filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi
        },
        { //Какие данные можно взять с Discord
            requests: [
                {
                    type: "track",
                    filter: /attachments/,
                    run: (url: string): Promise<ISong.track> => {
                        return new Promise((resolve, reject) => {
                            try {
                                FFprobe(url).then((trackInfo: any) => {
                                    //Если не найдена звуковая дорожка
                                    if (!trackInfo) return null;

                                    return resolve({
                                        url, author: null, image: { url: Music.note },
                                        title: url.split("/").pop(),
                                        duration: { seconds: trackInfo.format.duration },
                                        format: { url: trackInfo.format.filename }
                                    });
                                });
                            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                        });
                    }
                }
            ],

            name: "DISCORD",
            audio: true,
            color: Colors.Grey,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi
        }
    ]
};
//====================== ====================== ====================== ======================
//Проверяем наличие данных авторизации и возможность получить аудио
if (Platforms.audio.length === 0) (() => {
    if (!env.get("SPOTIFY_ID") || !env.get("SPOTIFY_SECRET")) Platforms.auth.push("SPOTIFY");
    if (!env.get("VK_TOKEN")) Platforms.auth.push("VK");
    if (!env.get("YANDEX")) Platforms.auth.push("YANDEX");

    //Если платформа не поддерживает получение аудио
    for (let platform of Platforms.all) {
        if (!platform.audio) Platforms.audio.push(platform.name);
    }
})();
//====================== ====================== ====================== ======================
/*                           Namespace for getting data platforms                          */
//====================== ====================== ====================== ======================

namespace Platform {
    /**
     * @description Получаем платформы с которых невозможно включить треки из проблем с авторизацией
     * @param platform {index} Платформа
     */
    export function isFailed(platform: platform): boolean {
        return Platforms.auth.includes(platform);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем платформы с которых невозможно включить треки
     * @param platform {index} Платформа
     */
    export function isAudio(platform: platform) {
        return Platforms.audio.includes(platform);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем цвет платформы
     * @param platform {index} Платформа
     */
    export function color(platform: platform): number | null {
        const findPlatforms = Platforms.all.find((info) => info.name === platform);

        if (findPlatforms) return findPlatforms.color;
        return null;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param platform {index} Платформа
     * @param type {callback} Тип запроса
     */
    export function callback(platform: platform, type: callback) {
        const findPlatforms = Platforms.all.find((info) => info.name === platform);

        const callback = findPlatforms.requests.find((data) => data.type === type);

        if (!callback) return null;

        return callback.run;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем тип запроса
     * @param url {string} Ссылка
     * @param platform {index} Платформа
     */
    export function type(url: string, platform: platform): callback {
        if (!url) return "track";
        else if (!url.startsWith("http")) return "search";

        const Platform = Platforms.all.find((plt) => plt.name === platform);
        const type = Platform.requests.find((data) => data.filter && url.match(data.filter));

        if (!type) return undefined;

        return type.type;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем название платформы
     * @param str {string} Название трека или ссылка
     */
    export function name(str: string): platform {
        //Если пользователь ищет трек по ссылке
        if (str.match(/^(https?:\/\/)/gi)) {
            const findPlatform = Platforms.all.filter((info) => str.match(info.filter));

            //Если нет платформы в базе
            if (!findPlatform.length) return undefined;

            return findPlatform[0].name;
        } else { //Если пользователь ищет трек по названию
            const prefix = str.split(' '), platform = prefix[0].toLowerCase();
            const findPlatform = Platforms.all.find((info) => info.prefix && info.prefix.includes(platform));

            if (findPlatform) return findPlatform.name;
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
        const findPlatform = Platforms.all.find((info) => info.name === ArrayArg[0].toUpperCase() || info.prefix && info.prefix.includes(ArrayArg[0].toLowerCase()));

        if (findPlatform && ArrayArg.length > 1) {
            ArrayArg.splice(0, 1);

            return ArrayArg.join(" ");
        }

        return str;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем полную информацию о платформе
     * @param platform {index} Платформа
     */
    export function full(platform: platform) {
        return Platforms.all.find((pl) => pl.name === platform);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    export function searchResource({ platform, url, author, title, duration }: Song): Promise<string> {
        if (!isAudio(platform)) {
            const callback = Platform.callback(platform, "track");

            //Если нет такой платформы или нет callbacks.track
            if (typeof callback === "string") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<ISong.track>).then((track: ISong.track) => track?.format?.url);
        }
        //Ищем трек
        let track = searchTrack(`${author.title} ${title}`, duration.seconds, platform);

        //Если трек не найден пробуем 2 вариант без автора
        if (!track) track = searchTrack(title, duration.seconds, platform);

        return track;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на yandex music, если нет токена yandex music или yandex не дал ссылку то ищем на YouTube
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @param platform {index} Платформа
     */
    function searchTrack(nameSong: string, duration: number, platform: platform): Promise<string> {
        const exPlatform = isFailed(platform) || isAudio(platform) ? isFailed("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const callbacks = full(exPlatform).requests;

        const search = callbacks.find((req) => req.type === "search");
        const track = callbacks.find((req) => req.type === "track");

        return (search.run(nameSong) as Promise<ISong.track[]>).then((tracks: ISong.track[]) => {
            //Фильтруем треки оп времени
            const FindTracks: ISong.track[] = tracks.filter((track: ISong.track) => {
                const DurationSong: number = (exPlatform === "YOUTUBE" ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return (track.run(FindTracks[0].url) as Promise<ISong.track>).then((video: ISong.track) => video?.format?.url) as Promise<string>;
        });
    }
}


//Поддерживаемые платформы
type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";

//Поддерживаемые типы для этих платформ
type callback = "track" | "playlist" | "search" | "album" | "artist";

//Как должен выглядеть один запрос
interface request {
    //Имя запроса
    type: callback;

    //Как фильтровать
    filter?: RegExp;

    //Получение данных
    run: (url: string) => Promise<ISong.track> | Promise<ISong.track[]> | Promise<ISong.playlist>;
}

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
    requests: request[];
}
