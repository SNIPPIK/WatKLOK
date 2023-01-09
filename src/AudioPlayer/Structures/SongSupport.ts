import {SoundCloud, Spotify, VK, YandexMusic, YouTube} from "@APIs";
import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {ArraySort} from "@Handler/Modules/Object/ArraySort";
import {InputPlaylist, InputTrack, Song} from "@Queue/Song";
import {Music, ReactionMenuSettings} from "@db/Config.json";
import {DurationUtils} from "@Managers/DurationUtils";
import {replacer} from "@Structures/Handle/Command";
import {Colors} from "discord.js";
import {FFspace} from "@FFspace";
import {env} from "@env";

//Поддерживаемые платформы
export type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "DISCORD" | "YANDEX";
//Поддерживаемые тип для этих платформ
export type callback = "track" | "playlist" | "search" | "album";

const emoji = ReactionMenuSettings.emojis.cancel;

/*
Для добавления поддержки других платформ надо указать как получать данные в {Platforms}
Доступные типы запросов {callback}, доступные платформы {platform}
Если при указывании новой платформы с нее невозможно получать треки добавить в {PlatformsAudio}
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
})();
//====================== ====================== ====================== ======================
/**
 * @description Платформы на которых недоступно получение музыки
**/
const PlatformsAudio = ["SPOTIFY", "YANDEX"];
//====================== ====================== ====================== ======================
/**
 * @description Список всех доступных платформ
**/
//Все возможные запросы данных в JSON формате
const Platforms = {
    //Какие данные можно взять с YouTube
    "YOUTUBE": {
        "color": 0xed4245,
        "prefix": ["yt", "ytb"],
        "reg": /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi,

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": YouTube.getVideo,
            "playlist": YouTube.getPlaylist,
            "search": YouTube.SearchVideos
        }
    },
    //Какие данные можно взять с Spotify
    "SPOTIFY": {
        "color": 1420288,
        "prefix": ["sp"],
        "reg": /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi,

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": Spotify.getTrack,
            "playlist": Spotify.getPlaylist,
            "album": Spotify.getAlbum,
            "search": Spotify.SearchTracks
        }
    },
    //Какие данные можно взять с Soundcloud
    "SOUNDCLOUD": {
        "color": 0xe67e22,
        "prefix": ["sc"],
        "reg": /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi,

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
        "color": 30719,
        "prefix": ["vk"],
        "reg": /vk.com/gi,

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": VK.getTrack,
            "playlist": VK.getPlaylist,
            "search": VK.SearchTracks
        }
    },
    //Какие данные можно взять с Yandex music
    "YANDEX": {
        "color": Colors.Yellow,
        "prefix": ["ym", "yandex"],
        "reg": /music.yandex.ru/gi,

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": YandexMusic.getTrack,
            "album": YandexMusic.getAlbum,
            "search": YandexMusic.SearchTracks
        }
    },
    //Какие данные можно взять с Discord
    "DISCORD": {
        "color": Colors.Grey,
        "reg": /^(https?:\/\/)?(cdn\.)?( )?(discordapp)\/.+$/gi,

        //Доступные запросы для этой платформы
        "callbacks": {
            "track": (url: string): Promise<InputTrack> => FFspace.FFprobe(url).then((trackInfo: any) => {
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

/**
 * @description Набор функций для получения данных из {Platforms, RegisterPlatform}
 */
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
        const clb = plt[type] as (str: string) => Promise<InputTrack | InputPlaylist | InputTrack[]>;

        if (!clb) return "!callback";

        return clb;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем тип запроса
     * @param str {string} Ссылка
     */
    export function getTypeSong(str: string) {
        //Если нет str, значит пользователь прикрепил файл
        if (!str) return "track";

        //Если str является ссылкой
        if (str.match(/^(https?:\/\/)/gi)) {
            if (str.match(/playlist/)) return "playlist";
            else if ((str.match(/album/) || str.match(/sets/)) && !str.match(/track/)) return "album";
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
                //Если пользователь ищет трек по названию
                const spSearch = str.split(' '), pl = spSearch[0].toLowerCase();
                const platform = platforms.filter(([, value]) => "prefix" in value && (value as typeof Platforms["YOUTUBE"])?.prefix.includes(pl));
                const [key] = platform[0];

                return key.toUpperCase() as platform;
            }
        } catch (e) {
            console.log(e);
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
        if (!str) return str;

        //Если пользователь ищет трек по ссылке
        if (str.match(/^(https?:\/\/)/gi)) return str;

        //Если пользователь ищет трек по названию
        const spSearch = str.split(' '), pl = spSearch[0].toLowerCase();
        // @ts-ignore
        const aliases = pl === platform.toLowerCase() || Platforms[platform].prefix?.includes(pl);

        //Если пользователь ищет трек с префиксом платформы
        if (aliases) {
            spSearch.splice(0, 1);

            return spSearch.join(" ");
        }
        return str;
    }
}
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
/**
 * @description Набор функций для поиска ссылки на исходный ресурс если что-то пошло не так
 */
export namespace SongFinder {
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    export function getLinkResource(song: Song): Promise<string> {
        const {platform, url, author, title, duration} = song;

        if (PlatformsAudio.includes(platform)) return FindTrack(`${author.title} - ${title} (Lyrics)`, duration.seconds);

        const callback = platformSupporter.getCallback(platform);

        if (callback === "!platform" || callback === "!callback") return null;

        return callback(url).then((track: InputTrack) => track?.format?.url);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на YouTube, если невозможно получить данные другим путем
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @constructor
     * @private
     */
    function FindTrack(nameSong: string, duration: number): Promise<string> {
        return YouTube.SearchVideos(nameSong, {limit: 20}).then((Tracks) => {
            //Фильтруем треки оп времени
            const FindTracks: InputTrack[] = Tracks.filter((track: InputTrack) => {
                const DurationSong = DurationUtils.ParsingTimeToNumber(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return YouTube.getVideo(FindTracks[0].url).then((video) => video?.format?.url) as Promise<string>;
        });
    }
}
//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
/**
 * @description Передаем информацию в Queue
 */
export namespace toPlayer {
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Что требует пользователь
     */
    export function play(message: ClientMessage, arg: string): void {
        const {author, client} = message;
        const voiceChannel = message.member.voice;
        const type = platformSupporter.getTypeSong(arg); //Тип запроса
        const platform = platformSupporter.getPlatform(arg); //Платформа с которой будем взаимодействовать
        const argument = platformSupporter.getArg(arg, platform);

        //Если нельзя получить данные с определенной платформы
        if (platformSupporter.getFailPlatform(platform)) return UtilsMsg.createMessage({
            text: `${author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`, color: "DarkRed", codeBlock: "css", message
        });

        const callback = platformSupporter.getCallback(platform, type); //Ищем в списке платформу

        if (callback === "!platform") return UtilsMsg.createMessage({
            text: `${author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "DarkRed", message
        });
        else if (callback === "!callback") return UtilsMsg.createMessage({
            text: `${author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!\nПлатформа: **${platform}**`, color: "DarkRed", message
        });

        const runCallback = callback(argument) as Promise<InputTrack | InputPlaylist | InputTrack[]>;

        //Если выходит ошибка
        runCallback.catch((err) => UtilsMsg.createMessage({ text: `${author}, данные не были найдены!\nПричина: ${err}`, color: "DarkRed", message }));

        runCallback.then((data: InputTrack | InputPlaylist | InputTrack[]): void => {
            if (!data) return UtilsMsg.createMessage({text: `${author}, данные не были найдены!`, color: "Yellow", message});

            //Если пользователь ищет трек
            if (data instanceof Array) return toSend(data, {message, platform});

            //Загружаем трек или плейлист в GuildQueue
            return client.player.play(message as any, voiceChannel.channel, data);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение о том что удалось найти
     * @param results {InputTrack[]} Результаты поиска
     * @param options {Options}
     * @requires {Reaction, deleteMessage}
     */
    function toSend(results: InputTrack[], options: { platform?: platform, message: ClientMessage }): void {
        const {message, platform} = options;
        const {author, client} = message;

        if (results.length < 1) return UtilsMsg.createMessage({ text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });

        const choice = `Выбери от 1 до ${results.length}`;
        const requester = `[Платформа: ${platform} | Запросил: ${author.username}]`;
        const songsList = ArraySort<InputTrack>(15, results, (track, index ) => {
            const Duration = platform === "YOUTUBE" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds)); //Проверяем надо ли конвертировать время
            const NameTrack = `[${replacer.replaceText(track.title, 80, true)}]`; //Название трека
            const DurationTrack = `[${Duration ?? "LIVE"}]`; //Длительность трека
            const AuthorTrack = `[${replacer.replaceText(track.author.title, 12, true)}]`; //Автор трека

            return `${index+1} ➜ ${DurationTrack} | ${AuthorTrack} | ${NameTrack}`;
        });
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
                    return play(message as any, url);
                });
            });
        };

        //Отправляем сообщение
        (message as ClientMessage).channel.send(`\`\`\`css\n${choice}\n${requester}\n\n${songsList}\`\`\``).then((msg) => {
            return callback(msg as ClientMessage);
        });
    }
}