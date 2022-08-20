import {MessageCollector, MessageReaction, StageChannel, User, VoiceChannel} from "discord.js";
import {httpsClient} from "../../httpsClient";
import {Song} from "../Structures/Queue/Song";
import {FFmpegFormat, InputPlaylist, InputTrack} from "../../Utils/TypeHelper";
import {SoundCloud, Spotify, VK, YouTube} from "../../Platforms";
import {FFmpeg} from "../Structures/Media/FFmpeg";
import {Images} from "../Structures/EmbedMessages";
import {DurationUtils} from "../Manager/DurationUtils";
import {IncomingMessage} from "http";
import {ClientMessage} from "../../../Events/Activity/Message";

const youtubeStr = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
const spotifySrt = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
const SoundCloudSrt = /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/;
const UrlSrt = /^(https?:\/\/)/gi;

//Все возможные запросы данных в JSON формате
const localPlatform = {
    //YouTube
    "yt": {
        "track": (search: string): Promise<InputTrack> => YouTube.getVideo(search) as Promise<InputTrack>,
        "playlist": (search: string): Promise<InputPlaylist> => YouTube.getPlaylist(search),
        "search": (search: string): Promise<InputTrack[]> => YouTube.SearchVideos(search),
    },
    //Spotify
    "sp": {
        "track": (search: string): Promise<InputTrack> => Spotify.getTrack(search),
        "playlist": (search: string): Promise<InputPlaylist> => Spotify.getPlaylist(search),
        "search": (search: string): Promise<InputTrack[]> => Spotify.SearchTracks(search),
        "album": (search: string): Promise<InputPlaylist> => Spotify.getAlbum(search)
    },
    //SoundCloud
    "sc": {
        "track": (search: string): Promise<InputTrack> => SoundCloud.getTrack(search),
        "playlist": (search: string): Promise<InputPlaylist | InputTrack> => SoundCloud.getPlaylist(search),
        "search": (search: string): Promise<InputTrack[]> => SoundCloud.SearchTracks(search),
        "album": (search: string): Promise<InputPlaylist | InputTrack> => SoundCloud.getPlaylist(search)
    },
    //VK
    "vk": {
        "track": (search: string): Promise<InputTrack> => VK.getTrack(search),
        "playlist": (search: string): Promise<InputPlaylist> => VK.getPlaylist(search),
        "search": (search: string): Promise<InputTrack[]> => VK.SearchTracks(search),
    },
    //Discord
    "ds": {
        "track": (search: string): Promise<InputTrack> => new FFmpeg.FFprobe(["-i", search]).getInfo().then((trackInfo: any) => {
            //Если не найдена звуковая дорожка
            if (!trackInfo) return null;

            return {
                url: search,
                title: search.split("/").pop(),
                author: null,
                image: {url: Images.NotImage},
                duration: {seconds: trackInfo.format.duration},
                format: {url: trackInfo.format.filename}
            };
        })
    }
}

export namespace Searcher {
    /**
     * @description Ищем и передаем в плеер данные
     * @param options {Options} Параметры
     */
    export function toPlayer(options: Options): void {
        const {search, message, voiceChannel} = options;
        const type: TypeFindTrack = toPlayerUtils.typeSong(search);
        const platform: TypeSearch = toPlayerUtils.PlatformSong(search, message);

        //Отправляем сообщение о поиске трека
        if (!message.attachments?.last()?.url) message.client.sendMessage({ text: `Поиск 🔍 | ${search}`, message, color: "YELLOW", type: "css" });

        const findPlatform = localPlatform[platform];
        const findCallback = (findPlatform as any)[type];

        //Если нет в базе платформы
        if (!findPlatform) return message.client.sendMessage({text: `${message.author}, у меня нет поддержки такой платформы!`, color: "RED", message});
        //Если есть платформа, но нет callbacks в платформе
        else if (!findCallback) return message.client.sendMessage({text: `${message.author}, у меня нет поддержки этого типа запроса!`, color: "RED", message});

        const newSearch = type === "search" && search?.match(platform) ? search.split(platform)[1] : search;
        const runPromise = findCallback(newSearch) as Promise<InputTrack | InputPlaylist | InputTrack[]>;

        runPromise.then((info: InputTrack | InputPlaylist | InputTrack[]) => {
            if (!info) return message.client.sendMessage({text: `${message.author}, данные не были найдены!`, color: "YELLOW", message});

            //Если пользователь ищет трек
            if (info instanceof Array) return SearchSongMessage.toSend(info, info.length, {...options, platform, type});

            //Сообщаем что трек был найден
            if (type !== "playlist") message.client.sendMessage({ text: `Найден 🔍 | ${type} | ${info.title}`, message, color: "YELLOW", type: "css" });

            //Загружаем трек или плейлист в GuildQueue
            return message.client.player.emit("play", message, voiceChannel, info);
        });
        //Если выходит ошибка
        runPromise.catch((err) => message.client.sendMessage({text: `${message.author}, данные не были найдены! \nError: ${err}`, color: "RED", message}));
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем статус код на ресурс
     * @param song {Song} Трек
     * @param req {number} Какой по счету запрос
     */
    export function toCheckResource(song: Song, req = 1): Promise<Song["format"] | null> {
        return new Promise(async (resolve) => {
            if (req > 2) return resolve(null);

            const CheckResource = await ResourceSong.CheckHeadResource(song);

            //Если выходит ошибка или нет ссылки на исходный ресурс
            if (!CheckResource || !song.format?.url) {
                req++;
                return resolve(toCheckResource(song, req));
            }
            return resolve(song.format);
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Searcher<toCheckResource>
 */
namespace ResourceSong {
    /**
     * @description Ищет трек и проверяем его работоспособность
     * @param song {Song} Трек
     */
    export function CheckHeadResource(song: Song): Promise<boolean> {
        return new Promise(async (resolve) => {
            if (!song.format || !song.format?.url) {
                let format = await getFormatSong(song);

                if (!format || !format?.url) {
                    song.format = {url: null};
                    return resolve(false);
                }
                //Добавляем ссылку в трек
                song.format = {url: format.url};
            }

            //Делаем head запрос на сервер
            const resource = await CheckLink(song.format?.url);
            if (resource === "Fail") { //Если выходит ошибка
                song.format = {url: null};
                return resolve(false);
            }
            return resolve(true);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем ссылку
     * @param url {string} Ссылка
     * @constructor
     */
    function CheckLink(url: string) {
        if (!url) return "Fail";

        return httpsClient.Request(url, {request: {method: "HEAD"}}).then((resource: IncomingMessage) => {
            if (resource instanceof Error) return "Fail"; //Если есть ошибка
            if (resource.statusCode >= 200 && resource.statusCode < 400) return "OK"; //Если возможно скачивать ресурс
            return "Fail"; //Если прошлые варианты не подходят, то эта ссылка не рабочая
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные формата
     * @param song {Song} Трек
     * @requires {FindTrack}
     */
    function getFormatSong({type, url, title, author, duration}: Song): Promise<FFmpegFormat> {
        try {
            switch (type) {
                case "SPOTIFY": return FindTrack(`${author.title} - ${title}`, duration.seconds);
                case "SOUNDCLOUD": return SoundCloud.getTrack(url).then((d) => d?.format);
                case "VK": return VK.getTrack(url).then((d) => d?.format);
                case "YOUTUBE": return YouTube.getVideo(url).then((video) => video.format) as Promise<FFmpegFormat>
                default: return null
            }
        } catch {
            console.log("[FindResource]: Fail to found format");
            return null;
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на youtube
     * @param nameSong {string} Название музыки
     * @param duration
     * @constructor
     */
    function FindTrack(nameSong: string, duration: number): Promise<FFmpegFormat> {
        return YouTube.SearchVideos(nameSong, {limit: 15}).then((Tracks) => {
            //Фильтруем треки оп времени
            const FindTracks = Tracks.filter((track: InputTrack) => {
                const DurationSong = DurationUtils.ParsingTimeToNumber(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 10 && DurationSong > duration - 10;
            });

            //Если треков нет
            if (FindTracks.length === 0) return null;

            //Получаем данные о треке
            return YouTube.getVideo(FindTracks[0].url).then((video) => video.format) as Promise<FFmpegFormat>;
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Функции для Searcher<toPlayer>
 */
namespace toPlayerUtils {
    /**
     * @description Независимо от платформы делаем проверку типа ссылки
     * @param search {string} Что там написал пользователь
     * @private
     */
    export function typeSong(search: string) {
        if (!search) return "track"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(/playlist/)) return "playlist";
        else if (search.match(/album/) || search.match(/sets/)) return "album";
        else if (search.match(UrlSrt)) return "track";
        return "search";
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем инициалы платформы
     * @param search {string} Что там написал пользователь
     * @param message {ClientMessage} Сообщение
     * @private
     */
    export function PlatformSong(search: string, message: ClientMessage): TypeSearch {
        if (!search) return "ds"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(UrlSrt)) {
            if (search.match(youtubeStr)) return "yt";
            else if (search.match(spotifySrt)) return "sp";
            else if (search.match(/vk.com/)) return "vk";
            else if (search.match(SoundCloudSrt)) return "sc";
            else if (search.match(/cdn.discordapp.com/) || message.attachments?.last()?.url) return "ds";
        }

        const SplitSearch = search.split(' ');
        const FindType = SplitSearch[0].toLowerCase() as "yt" | "sp" | "vk" | "sc";

        if (FindType.length > 2) return "yt";
        return FindType;
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Сообщение о поиске треков
 */
namespace SearchSongMessage {
    /**
     * @description Отправляем сообщение о том что удалось найти
     * @param results {any[]} Результаты поиска
     * @param num {number} Кол-во найденных треков
     * @param options {Options}
     * @requires {Reaction, CreateMessageCollector, deleteMessage, Searcher}
     * @constructor
     */
    export function toSend(results: InputTrack[], num: number, options: Options): void {
        const {message, platform} = options;

        setImmediate(() => {
            if (results.length < 1) return message.client.sendMessage({text: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, message, color: "RED"});

            const ConstFind = `Выбери от 1 до ${results.length}`; //Показываем сколько есть треков в списке
            const Requester = `[Платформа: ${platform} | Запросил: ${message.author.username}]`; //Показываем платформу и того кто запросил
            const resp = ArrayToString(results, message, platform)

            //Отправляем сообщение
            message.channel.send(`\`\`\`css\n${ConstFind}\n${Requester}\n\n${resp}\`\`\``).then((msg: ClientMessage) => {
                //Создаем сборщик
                const collector = CreateMessageCollector(msg, message, num);

                //Делаем что-бы при нажатии на эмодзи удалялся сборщик
                Reaction(msg, message, "❌", () => {
                    deleteMessage(msg); //Удаляем сообщение
                    collector?.stop();
                });

                //Что будет делать сборщик после нахождения числа
                collector.once("collect", (m: any): void => {
                    setImmediate(() => {
                        [msg, m].forEach((m: ClientMessage) => deleteMessage(m)); //Удаляем сообщения, бота и пользователя
                        collector?.stop(); //Уничтожаем сборщик

                        //Получаем ссылку на трек, затем включаем его
                        const url = results[parseInt(m.content) - 1].url;
                        return Searcher.toPlayer({...options, type: "track", search: url})
                    });
                });

                return;
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description добавляем под сообщение эмодзи
     * @param msg {ClientMessage} Сообщение, бота
     * @param message {ClientMessage} Сообщение, пользователя
     * @param emoji {string} сам эмодзи
     * @param callback {Function} Что будет происходить при нажатии на эмодзи
     * @constructor
     */
    function Reaction(msg: ClientMessage, message: ClientMessage, emoji: string, callback: Function): void {
        setImmediate(() => {
            //Добавляем реакцию под сообщением
            msg.react(emoji).then(() => {
                const collector = msg.createReactionCollector({
                    filter: (reaction: MessageReaction, user: User) => (reaction.emoji.name === emoji && user.id !== message.client.user.id),
                    max: 1,
                    time: 60e3 //Через 1 мин сборщик не будет работать
                });
                //Что будет делать сборщик после нажатия на реакцию
                collector.once("collect", () => {
                    collector?.stop();
                    return callback();
                });
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем коллектор (discord.js) для обработки сообщений от пользователя
     * @param msg {ClientMessage} Сообщение, бота
     * @param message {ClientMessage} Сообщение, пользователя
     * @param num {number} Кол-во треков
     * @constructor
     */
    function CreateMessageCollector(msg: ClientMessage, message: ClientMessage, num: number): MessageCollector {
        //Сборщик чисел, отправленных пользователем
        return msg.channel.createMessageCollector({
            filter: (m: any) => !isNaN(m.content) && m.content <= num && m.content > 0 && m.author.id === message.author.id,
            max: 1,
            time: 60e3 //Через 1 мин сборщик не будет работать
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Собираем найденные треки в <string>
     * @param results {any[]} Результаты поиска
     * @param message {ClientMessage} Сообщение
     * @param type {TypeSearch} Платформа на которой искали
     * @requires {ParsingTimeToString}
     * @constructor
     */
    function ArrayToString(results: InputTrack[], message: ClientMessage, type: TypeSearch): string {
        let NumberTrack = 1, StringTracks;

        // @ts-ignore
        results.ArraySort(15).forEach((tracks: InputTrack[]) => {
            StringTracks = tracks.map((track) => {
                const Duration = type === "yt" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds)); //Проверяем надо ли конвертировать время
                const NameTrack = `[${message.client.replaceText(track.title, 80, true)}]`; //Название трека
                const DurationTrack = `[${Duration ?? "LIVE"}]`; //Длительность трека
                const AuthorTrack = `[${message.client.replaceText(track.author.title, 12, true)}]`; //Автор трека

                return `${NumberTrack++} ➜ ${DurationTrack} | ${AuthorTrack} | ${NameTrack}`;
            }).join("\n");
        });
        return StringTracks;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем сообщение
     * @param msg {ClientMessage} Сообщение которое надо удалить
     */
    function deleteMessage(msg: ClientMessage): void {
        setTimeout(() => msg.delete().catch(() => null), 1e3);
    }
}

//Типы данных
type TypeFindTrack = "track" | "playlist" | "search" | "album";
//Платформы
type TypeSearch = "yt" | "sp" | "vk" | "sc" | "ds";
//Данные которые необходимо передать для поиска
interface Options {
    type?: TypeFindTrack
    platform?: TypeSearch
    search: string
    message: ClientMessage
    voiceChannel: VoiceChannel | StageChannel
}