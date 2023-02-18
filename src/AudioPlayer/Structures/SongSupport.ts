import {SoundCloud, Spotify, VK, YandexMusic, YouTube} from "@AudioPlayer/APIs";
import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {Music, ReactionMenuSettings, APIs} from "@db/Config.json";
import {inPlaylist, inTrack, Song} from "@Queue/Song";
import {DurationUtils} from "@Managers/DurationUtils";
import {replacer} from "@Structures/Handle/Command";
import {ArraySort} from "@Structures/ArraySort";
import {Colors} from "discord.js";
import {FFspace} from "@FFspace";
import {env} from "@env";
import { Balancer } from "@Structures/Balancer";

//Поддерживаемые платформы
export type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";
//Поддерживаемые тип для этих платформ
export type callback = "track" | "playlist" | "search" | "album" | "artist";

const emoji: string = ReactionMenuSettings.emojis.cancel;

//====================== ====================== ====================== ======================
/**
 * Для добавления поддержки других платформ надо указать как получать данные в {APIs}
 * Доступные типы запросов {callback}, доступные платформы {platform}
 * Если при указывании новой платформы с нее невозможно получать треки добавить в {PlatformsAudio}
 */
//====================== ====================== ====================== ======================

/**
 * @description Платформы которые нельзя использовать из-за ошибок авторизации
 */
const RegisterPlatform: platform[] = [];
//Проверяем наличие данных авторизации
(() => {
    if (!env.get("SPOTIFY_ID") || !env.get("SPOTIFY_SECRET")) RegisterPlatform.push("SPOTIFY");
    if (!env.get("VK_TOKEN")) RegisterPlatform.push("VK");
    if (!env.get("YANDEX")) RegisterPlatform.push("YANDEX");
})();
//====================== ====================== ====================== ======================
/**
 * @description Платформы на которых недоступно получение музыки
**/
const PlatformsAudio: platform[] = ["SPOTIFY"];
//====================== ====================== ====================== ======================
/**
 * @description Список всех доступных платформ
**/
//Все возможные запросы данных в JSON формате
const Platforms = {
    //Какие данные можно взять с YouTube
    "YOUTUBE": {
        "color": 0xed4245, //Цвет трека
        "prefix": ["yt", "ytb"], //Префиксы для поиска
        "reg": /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": YouTube.getVideo,
            "playlist": YouTube.getPlaylist,
            "search": YouTube.SearchVideos,
            "artist": YouTube.getChannelVideos
        }
    },
    //Какие данные можно взять с Spotify
    "SPOTIFY": {
        "color": 1420288, //Цвет трека
        "prefix": ["sp"], //Префиксы для поиска
        "reg": /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": Spotify.getTrack,
            "playlist": Spotify.getPlaylist,
            "album": Spotify.getAlbum,
            "search": Spotify.SearchTracks,
            "artist": Spotify.getAuthorTracks
        }
    },
    //Какие данные можно взять с Soundcloud
    "SOUNDCLOUD": {
        "color": 0xe67e22, //Цвет трека
        "prefix": ["sc"], //Префиксы для поиска
        "reg": /^(https?:\/\/)?((?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": SoundCloud.getTrack,
            "playlist": SoundCloud.getPlaylist,
            "album": SoundCloud.getPlaylist,
            "search": SoundCloud.SearchTracks
        }
    },
    //Какие данные можно взять с VK
    "VK": {
        "color": 30719, //Цвет трека
        "prefix": ["vk"], //Префиксы для поиска
        "reg": /^(https?:\/\/)?(vk\.com)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": VK.getTrack,
            "playlist": VK.getPlaylist,
            "search": VK.SearchTracks
        }
    },
    //Какие данные можно взять с Yandex music
    "YANDEX": {
        "color": Colors.Yellow, //Цвет трека
        "prefix": ["ym", "yandex", "y"], //Префиксы для поиска
        "reg": /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": YandexMusic.getTrack,
            "album": YandexMusic.getAlbum,
            "search": YandexMusic.SearchTracks,
            "artist": YandexMusic.getArtistTracks
        }
    },
    //Какие данные можно взять с Discord
    "DISCORD": {
        "color": Colors.Grey, //Цвет трека
        "reg": /^(https?:\/\/)?(cdn\.)?( )?(discordapp)\/.+$/gi, //Как фильтровать ссылки

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": (url: string): Promise<inTrack> => FFspace.FFprobe(url).then((trackInfo: any) => {
                //Если не найдена звуковая дорожка
                if (!trackInfo) return null;

                return {
                    url, author: null, image: {url: Music.images._image},
                    title: url.split("/").pop(),
                    duration: {seconds: trackInfo.format.duration},
                    format: {url: trackInfo.format.filename}
                };
            })
        }
    }
};

//====================== ====================== ====================== ======================
/*                        Namespace for get information a platforms                        */
//====================== ====================== ====================== ======================
export namespace platformSupporter {
    /**
     * @description Получаем цвет трека
     * @param platform {platform} Платформа
     */
    export function getColor(platform: platform) { return Platforms[platform].color; }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем платформы с которых невозможно включить треки
     * @param platform {platform} Платформа
     */
    export function getFailPlatform(platform: platform): boolean { return RegisterPlatform?.includes(platform) ?? false; }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param platform {platform} Платформа
     * @param type {callback} Тип запроса
     */
    export function getCallback(platform: platform, type: callback = "track") {
        const plt = Platforms[platform]["callbacks"];

        if (!plt) return "!platform";

        // @ts-ignore
        const clb = plt[type] as (str: string) => Promise<inTrack | inPlaylist | inTrack[]>;

        if (!clb) return "!callback";

        return clb;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем тип запроса
     * @param str {string} Ссылка
     */
    export function getTypeSong(str: string): callback {
        //Если нет str, значит пользователь прикрепил файл
        if (!str) return "track";

        //Если str является ссылкой
        if (str.match(/^(https?:\/\/)/gi)) {
            if (str.match(/playlist/)) return "playlist";
            else if ((str.match(/album/) || str.match(/sets/)) && !str.match(/track/)) return "album";
            else if (str.match(/artist/) || str.match(/channel/) || str.match(/@/)) return "artist";
            return "track";
        }
        return "search";
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем название платформы
     * @param str {string} Ссылка
     */
    export function getPlatform(str: string): platform {
        const platforms = Object.entries(Platforms);

        try {
            if (str.match(/^(https?:\/\/)/gi)) {
                const filterPlatforms = platforms.filter(([, value]) => str.match(value.reg));
                const [key] = filterPlatforms[0];

                if (key) return key.toUpperCase() as platform;
                return "DISCORD";
            } else {
                try {
                    //Если пользователь ищет трек по названию
                    const spSearch = str.split(' '), pl = spSearch[0].toLowerCase();
                    const platform = platforms.filter(([, value]) => "prefix" in value && (value as typeof Platforms["YOUTUBE"])?.prefix.includes(pl));
                    const [key] = platform[0];

                    return key.toUpperCase() as platform;
                } catch (e) {
                    return "YOUTUBE";
                }
            }
        } catch (e) {
            return "DISCORD";
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем аргумент для Platform<callbacks>
     * @param str {string} Строка или ссылка
     * @param platform {platform} Платформа
     */
    export function getArg(str: string, platform: platform) {
        //Если нет search, значит пользователь прикрепил файл
        if (!str || str.match(/^(https?:\/\/)/gi)) return str;

        const arrayStr = str.split(' ');
        const Platform = arrayStr[0].toLowerCase();
        // @ts-ignore
        const findPlatform = Platform === platform || Platforms[platform].prefix.includes(Platform);

        //Если пользователь ищет трек с префиксом платформы
        if (findPlatform && arrayStr.length > 1) {
            arrayStr.splice(0, 1);

            return arrayStr.join(" ");
        }

        return str;
    }
}

//====================== ====================== ====================== ======================
/*                      Namespace for find platform in user arguments                      */
//====================== ====================== ====================== ======================
export namespace toPlayer {
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Что требует пользователь
     */
    export function play(message: ClientMessage, arg: string): void {
        const {author, client} = message;
        const voiceChannel = message.member.voice;

        Balancer.push(() => {
            const type = platformSupporter.getTypeSong(arg); //Тип запроса
            const platform = platformSupporter.getPlatform(arg); //Платформа с которой будем взаимодействовать
            const argument = platformSupporter.getArg(arg, platform);

            //Если нельзя получить данные с определенной платформы
            if (platformSupporter.getFailPlatform(platform)) return UtilsMsg.createMessage({ text: `${author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`, color: "DarkRed", message });

            const callback = platformSupporter.getCallback(platform, type); //Ищем в списке платформу

            if (callback === "!platform") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "DarkRed", message });
            else if (callback === "!callback") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!\nПлатформа: **${platform}**`, color: "DarkRed", message });

            const runCallback = callback(argument) as Promise<inTrack | inPlaylist | inTrack[]>;

            //Если включено показывать запросы
            if (Music.showGettingData) {
                //Отправляем сообщение о текущем запросе
                UtilsMsg.createMessage({ text: `${author}, производится запрос в **${platform.toLowerCase()}.${type}**`, color: "Grey", message });

                //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
                if (PlatformsAudio.includes(platform) && APIs.showWarningAudio) UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.\nЗапрос будет произведен в youtube.track`, color: "Yellow", codeBlock: "css", message });
            }

            runCallback.catch((e) => {
                if (e.length > 2e3) UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e.message}`, color: "DarkRed", codeBlock: "css", message });
                else UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e}`, color: "DarkRed", codeBlock: "css", message });
            });
            runCallback.then((data: inTrack | inPlaylist | inTrack[]): void => {
                if (!data) return UtilsMsg.createMessage({ text: `${author}, данные не были найдены!`, color: "Yellow", message });

                //Если пользователь ищет трек
                if (data instanceof Array) return toSend(data, {message, platform});

                //Загружаем трек или плейлист в GuildQueue
                return client.player.play(message, voiceChannel.channel, data);
            });
        });
    }
}

//====================== ====================== ====================== ======================
/*                             Namespace for find url resource                             */
//====================== ====================== ====================== ======================
export namespace SongFinder {
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    export function getLinkResource(song: Song): Promise<string> {
        const {platform, url, author, title, duration} = song;

        //Если для платформы нет поддержки перехвата аудио
        if (PlatformsAudio.includes(platform)) {
            //Ищем трек
            let track = FindTrack(`${author.title} ${title}`, duration.seconds, platform);

            //Если трек не найден пробуем 2 вариант без автора
            if (!track) track = FindTrack(title, duration.seconds, platform);

            return track;
        }

        const callback = platformSupporter.getCallback(platform);

        //Если нет такой платформы или нет callbacks.track
        if (callback === "!platform" || callback === "!callback") return null;

        //Выдаем ссылку
        return callback(url).then((track: inTrack) => track?.format?.url);
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Ищем трек на yandex music, если нет токена yandex music или yandex зажмотил ссылку то ищем на YouTube
 * @param nameSong {string} Название трека
 * @param duration {number} Длительность трека
 * @param platform {platform} Платформа
 */
function FindTrack(nameSong: string, duration: number, platform: platform): Promise<string> {
    //Если поиск недоступен на Yandex или если не получена ссылки с yandex
    const isYouTube = RegisterPlatform.includes("YANDEX") || platform === "YANDEX";

    return (isYouTube ? Platforms["YOUTUBE"] : Platforms["YANDEX"])["callbacks"]["search"](nameSong).then((Tracks: inTrack[]) => {
        //Фильтруем треки оп времени
        const FindTracks: inTrack[] = Tracks.filter((track: inTrack) => {
            const DurationSong: number = (isYouTube ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

            //Как надо фильтровать треки
            return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
        });

        //Если треков нет
        if (FindTracks?.length < 1) return null;

        //Получаем данные о треке
        return (isYouTube ? Platforms["YOUTUBE"] : Platforms["YANDEX"])["callbacks"]["track"](FindTracks[0].url).then((video: inTrack) => video?.format?.url) as Promise<string>;
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Отправляем сообщение о том что удалось найти
 * @param results {inTrack[]} Результаты поиска
 * @param options {Options}
 * @requires {Reaction, deleteMessage}
 */
function toSend(results: inTrack[], options: { platform?: platform, message: ClientMessage }): void {
    const {message, platform} = options;
    const {author, client} = message;

    if (results.length < 1) return UtilsMsg.createMessage({ text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });

    const choice = `Выбери от 1 до ${results.length}`;
    const requester = `[Платформа: ${platform} | Запросил: ${author.username}]`;
    const songsList = ArraySort<inTrack>(15, results, (track, index ) => {
        const Duration = platform === "YOUTUBE" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds)); //Проверяем надо ли конвертировать время
        const NameTrack = `[${replacer.replaceText(track.title, 80, true)}]`; //Название трека
        const DurationTrack = `[${Duration ?? "LIVE"}]`; //Длительность трека
        const AuthorTrack = `[${replacer.replaceText(track.author.title, 12, true)}]`; //Автор трека

        return `${index+1} ➜ ${DurationTrack} | ${AuthorTrack} | ${NameTrack}`;
    }, "\n");
    const callback = (msg: ClientMessage) => {
        //Создаем сборщик
        const collector = UtilsMsg.createCollector(msg.channel, (m) => {
            const messageNum = parseInt(m.content);
            return !isNaN(messageNum) && messageNum <= results.length && messageNum > 0 && m.author.id === author.id;
        });

        //Делаем что-бы при нажатии на эмодзи удалялся сборщик
        UtilsMsg.createReaction(msg, emoji,
            (reaction, user) => reaction.emoji.name === emoji && user.id !== client.user.id,
            () => {
                UtilsMsg.deleteMessage(msg, 1e3); //Удаляем сообщение
                collector?.stop();
            },
            30e3
        );

        //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
        setTimeout(() => {
            UtilsMsg.deleteMessage(msg, 1e3); //Удаляем сообщение
            collector?.stop();
        }, 30e3);

        //Что будет делать сборщик после нахождения числа
        collector.once("collect", (m: any): void => {
            setImmediate(() => {
                [msg, m].forEach(UtilsMsg.deleteMessage); //Удаляем сообщения, бота и пользователя
                collector?.stop(); //Уничтожаем сборщик

                //Получаем ссылку на трек, затем включаем его
                const url = results[parseInt(m.content) - 1].url;
                return toPlayer.play(message as any, url);
            });
        });
    };

    //Отправляем сообщение
    (message as ClientMessage).channel.send(`\`\`\`css\n${choice}\n${requester}\n\n${songsList}\`\`\``).then((msg) => {
        return callback(msg as ClientMessage);
    });
}