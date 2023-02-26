import { SoundCloud, Spotify, VK, YandexMusic, YouTube } from "@AudioPlayer/APIs";
import { ClientMessage, UtilsMsg } from "@Client/interactionCreate";
import { Music, ReactionMenuSettings, APIs } from "@db/Config.json";
import { inPlaylist, inTrack, Song } from "@Queue/Song";
import { DurationUtils } from "@Structures/Durations";
import { Balancer } from "@Structures/Balancer";
import { Colors } from "discord.js";
import { FFprobe } from "@FFspace";
import { env } from "@env";
import { EmbedMessages } from "./Messages/Embeds";

const emoji: string = ReactionMenuSettings.emojis.cancel;

export { toPlayer, Platform, SongFinder, platform };
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

const Platforms = {
    //Платформы у которых нет возможности получить доступ к аудио
    noAudio: ["SPOTIFY"] as string[],
    //Платформы у которых нет данных авторизации
    noAuth: [] as string[],

    //Все возможные запросы данных в JSON формате
    all: [
        { //Какие данные можно взять с YouTube
            platform: "YOUTUBE",
            color: 16711680, //Цвет трека
            prefix: ["yt", "ytb"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track: YouTube.getVideo,
                search: YouTube.SearchVideos,
                artist: YouTube.getChannelVideos,
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
                track: Spotify.getTrack,
                album: Spotify.getAlbum,
                search: Spotify.SearchTracks,
                artist: Spotify.getAuthorTracks,
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
                track: SoundCloud.getTrack,
                search: SoundCloud.SearchTracks,
                playlist: SoundCloud.getPlaylist,
                album: SoundCloud.getPlaylist
            }
        },
        { //Какие данные можно взять с VK
            platform: "VK",
            color: 30719, //Цвет трека
            prefix: ["vk"], //Префиксы для поиска
            reg: /^(https?:\/\/)?(vk\.com)\/.+$/gi, //Как фильтровать ссылки

            //Доступные запросы для этой платформы
            callbacks: {
                track: VK.getTrack,
                search: VK.SearchTracks,
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
                track: YandexMusic.getTrack,
                album: YandexMusic.getAlbum,
                search: YandexMusic.SearchTracks,
                artist: YandexMusic.getArtistTracks
            }
        },
        { //Какие данные можно взять с Discord
            platform: "DISCORD",
            color: Colors.Grey, //Цвет трека
            reg: /^(https?:\/\/)?(cdn\.)?( )?(discordapp)\/.+$/gi, //Как фильтровать ссылки

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
    ] as platformData[]
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
}


//====================== ====================== ====================== ======================
/*                             Namespace for find url resource                             */
//====================== ====================== ====================== ======================
namespace SongFinder {
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    export function getLinkResource(song: Song): Promise<string> {
        const { platform, url, author, title, duration } = song;

        if (!Platform.noAudio(platform)) {
            const callback = Platform.callback(platform, "track");

            //Если нет такой платформы или нет callbacks.track
            if (callback === "!platform" || callback === "!callback") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<inTrack>).then((track: inTrack) => track?.format?.url);
        }
        //Ищем трек
        let track = FindTrack(`${author.title} ${title}`, duration.seconds, platform);

        //Если трек не найден пробуем 2 вариант без автора
        if (!track) track = FindTrack(title, duration.seconds, platform);

        return track;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на yandex music, если нет токена yandex music или yandex зажмотил ссылку то ищем на YouTube
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @param platform {platform} Платформа
     */
    function FindTrack(nameSong: string, duration: number, platform: platform): Promise<string> {
        const handlePlatform = Platform.isFailed(platform) || Platform.noAudio(platform) ? Platform.isFailed("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const platformCallbacks = Platforms.all.find((info) => info.platform === handlePlatform).callbacks;

        return platformCallbacks.search(nameSong).then((Tracks: inTrack[]) => {
            //Фильтруем треки оп времени
            const FindTracks: inTrack[] = Tracks.filter((track: inTrack) => {
                const DurationSong: number = (handlePlatform === "YOUTUBE" ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return platformCallbacks.track(FindTracks[0].url).then((video: inTrack) => video?.format?.url) as Promise<string>;
        });
    }
}


//====================== ====================== ====================== ======================
/*                      Namespace for find platform in user arguments                      */
//====================== ====================== ====================== ======================
namespace toPlayer {
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Что требует пользователь
     */
    export function play(message: ClientMessage, arg: string): void {
        const { author } = message;

        Balancer.push(() => {
            const type = Platform.type(arg); //Тип запроса
            const platform = Platform.name(arg); //Платформа с которой будем взаимодействовать
            const argument = Platform.filterArg(arg);

            //Если нельзя получить данные с определенной платформы
            if (Platform.isFailed(platform)) return UtilsMsg.createMessage({ text: `${author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`, color: "Yellow", message });

            const callback = Platform.callback(platform, type); //Ищем в списке платформу

            if (callback === "!platform") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "Yellow", message });
            else if (callback === "!callback") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!\nПлатформа: **${platform}**`, color: "Yellow", message });

            //Если включено показывать запросы
            if (Music.showGettingData) sendGettingData(platform, type, message);

            return runCallback(callback(argument) as Promise<inTrack | inPlaylist | inTrack[]>, platform, message);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Показываем данные о том что будет получено
     * @param platform {platform} Платформа с кторой получаем данные
     * @param type {callback} Тип запроса
     * @param message {ClientMessage} Сообщение с сервера
     */
    function sendGettingData(platform: platform, type: callback, message: ClientMessage): void {
        //Отправляем сообщение о текущем запросе
        UtilsMsg.createMessage({ text: `${message.author}, производится запрос в **${platform.toLowerCase()}.${type}**`, color: "Grey", message });

        //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
        if (Platform.noAudio(platform) && APIs.showWarningAudio) {
            const workPlatform = Platform.isFailed("YANDEX") ? "youtube.track" : "yandex.track";

            UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.\nЗапрос будет произведен в ${workPlatform}`, color: "Yellow", codeBlock: "css", message });
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * 
     * @param callback {Function} Обрабатываемая функция получения данных
     * @param platform {platform} Платформа с кторой получаем данные
     * @param message  {ClientMessage} Сообщение с сервера
     */
    function runCallback(callback: Promise<inTrack | inTrack[] | inPlaylist>, platform: platform, message: ClientMessage): void {
        const { author, client } = message;
        const VoiceChannel = message.member.voice.channel;

        callback.catch((e) => {
            if (e.length > 2e3) UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e.message}`, color: "DarkRed", codeBlock: "css", message });
            else UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e}`, color: "DarkRed", codeBlock: "css", message });
        });
        callback.then((data: inTrack | inPlaylist | inTrack[]): void => {
            if (!data) return UtilsMsg.createMessage({ text: `${author}, данные не были найдены!`, color: "DarkRed", message });

            //Если пользователь ищет трек, но найден всего один
            if (data instanceof Array && data.length === 1) return client.player.handleContent(message, VoiceChannel, data[0]);

            //Если пользователь ищет трек
            else if (data instanceof Array) return searchTracks.toSend(data, platform, message);

            //Загружаем трек или плейлист в GuildQueue
            return client.player.handleContent(message, VoiceChannel, data);
        });
    }
}


//====================== ====================== ====================== ======================
/*                        Namespace to send search message to channel                      */
//====================== ====================== ====================== ======================
namespace searchTracks {
    /**
     * @description Оправляем сообщение о том что было найдено
     * @param tracks {inTracks[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param message {ClientMessage} Сообщение с сервера
     * @returns 
     */
    export function toSend(tracks: inTrack[], platform: platform, message: ClientMessage) {
        const { author, client } = message;

        if (tracks.length < 1) return UtilsMsg.createMessage({ text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });

        message.channel.send({ embeds: [EmbedMessages.toSearch(tracks, platform, author)] }).then((msg) => {
            //Создаем сборщик
            const collector = UtilsMsg.createCollector(msg.channel, (m) => {
                const messageNum = parseInt(m.content);
                return !isNaN(messageNum) && messageNum <= tracks.length && messageNum > 0 && m.author.id === author.id;
            });
            const clear = () => { UtilsMsg.deleteMessage(msg, 1e3); collector?.stop(); }

            //Делаем что-бы при нажатии на эмодзи удалялся сборщик
            UtilsMsg.createReaction(msg, emoji, (reaction, user) => reaction.emoji.name === emoji && user.id !== client.user.id, clear, 30e3);
            //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
            setTimeout(clear, 30e3);

            //Что будет делать сборщик после нахождения числа
            collector.once("collect", (m: any): void => {
                setImmediate(() => {
                    //Чистим чат и удаляем сборщик
                    UtilsMsg.deleteMessage(m); clear();

                    //Получаем ссылку на трек, затем включаем его
                    const url = tracks[parseInt(m.content) - 1].url;
                    return toPlayer.play(message as any, url);
                });
            });
        });
    }
}