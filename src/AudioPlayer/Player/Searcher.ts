import {ClientMessage} from "../../Handler/Events/Activity/Message";
import {StageChannel, VoiceChannel} from "discord.js";
import {InputPlaylist, InputTrack, SupportPlatforms} from "../Structures/Queue/Song";
import {GlobalUtils} from "../../Core/Utils/LiteUtils";
import {DurationUtils} from "../Manager/DurationUtils";

//Типы данных
type TypeFindTrack = "track" | "playlist" | "search" | "album";
//Платформы
type TypeSearch = "YOUTUBE" | "SPOTIFY" | "VK" | "SOUNDCLOUD" | "Discord";
//Данные которые необходимо передать для поиска
interface Options {
    type?: TypeFindTrack
    platform?: TypeSearch
    search: string
    message: ClientMessage
    voiceChannel: VoiceChannel | StageChannel
}

//Необходимо для поиска
const Platforms = {
    "yt": "YOUTUBE",
    "sp": "SPOTIFY",
    "sc": "SOUNDCLOUD",
    "vk": "VK"
};

const youtubeStr = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
const spotifySrt = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
const SoundCloudSrt = /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/;
const UrlSrt = /^(https?:\/\/)/gi;

const emoji = "❌";

export namespace Handle {
    /**
     * @description Ищем и передаем в плеер данные
     * @param options {Options} Параметры
     */
    export function toPlayer(options: Options) {
        const {search, message, voiceChannel} = options;
        const type = toPlayerUtils.typeSong(search); //Тип запроса
        const platform = toPlayerUtils.PlatformSong(search, message); //Платформа с которой будем взаимодействовать

        //Отправляем сообщение о поиске трека
        if (platform !== "Discord") message.client.sendMessage({ text: `Поиск 🔍 | ${search}`, message, color: "YELLOW", type: "css" });

        const findPlatform = SupportPlatforms[platform] ?? SupportPlatforms["YOUTUBE"]; //Ищем в списке платформу
        const findType = (findPlatform as any)[type]; //Ищем тип запроса

        if (!findPlatform) return message.client.sendMessage({text: `${message.author}, у меня нет поддержки такой платформы!`, color: "RED", message});
        else if (!findType) return message.client.sendMessage({text: `${message.author}, у меня нет поддержки этого типа запроса!`, color: "RED", message});

        const newSearch = type === "search" && search?.includes(platform) ? search.split(platform)[1] : search;
        const runCallback = findType(newSearch) as Promise<InputTrack | InputPlaylist | InputTrack[]>;

        runCallback.then((data: InputTrack | InputPlaylist | InputTrack[]) => {
            if (!data) return message.client.sendMessage({text: `${message.author}, данные не были найдены!`, color: "YELLOW", message});

            //Если пользователь ищет трек
            if (data instanceof Array) return SearchSongMessage.toSend(data, data.length, {...options, platform, type});

            //Сообщаем что трек был найден
            if (type !== "playlist") message.client.sendMessage({ text: `Найден 🔍 | ${type} | ${data.title}`, message, color: "YELLOW", type: "css" });

            //Загружаем трек или плейлист в GuildQueue
            return message.client.player.emit("play", message, voiceChannel, data);
        });
        //Если выходит ошибка
        runCallback.catch((err) => message.client.sendMessage({text: `${message.author}, данные не были найдены!\nError: ${err}`, color: "RED", message}));
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
     */
    export function PlatformSong(search: string, message: ClientMessage): TypeSearch {
        if (!search) return "Discord"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(UrlSrt)) {
            if (search.match(youtubeStr)) return "YOUTUBE";
            else if (search.match(spotifySrt)) return "SPOTIFY";
            else if (search.match(/vk.com/)) return "VK";
            else if (search.match(SoundCloudSrt)) return "SOUNDCLOUD";
            else if (search.match(/cdn.discordapp.com/) || message.attachments?.last()?.url) return "Discord";
        }
        const SplitSearch = search.split(' ');
        const platform = SplitSearch[0] as "yt" | "vk" | "sp" | "sc";

        if (platform.length === 2 && Platforms[platform]) return Platforms[platform] as TypeSearch;
        return platform.toUpperCase() as any;
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
     * @requires {Reaction, deleteMessage}
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
                const collector = GlobalUtils.createMessageCollector(message,(m) => {
                    const messageNum = parseInt(m.content);
                    return !isNaN(messageNum) && messageNum <= num && messageNum > 0 && m.author.id === message.author.id;
                });

                //Делаем что-бы при нажатии на эмодзи удалялся сборщик
                GlobalUtils.createReaction(msg, emoji, (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id, () => {
                    GlobalUtils.DeleteMessage(msg, 1e3); //Удаляем сообщение
                    collector?.stop();
                });

                //Что будет делать сборщик после нахождения числа
                collector.once("collect", (m: any): void => {
                    setImmediate(() => {
                        [msg, m].forEach(GlobalUtils.DeleteMessage); //Удаляем сообщения, бота и пользователя
                        collector?.stop(); //Уничтожаем сборщик

                        //Получаем ссылку на трек, затем включаем его
                        const url = results[parseInt(m.content) - 1].url;
                        return Handle.toPlayer({...options, type: "track", search: url})
                    });
                });

                return;
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Собираем найденные треки в <string>
     * @param results {any[]} Результаты поиска
     * @param message {ClientMessage} Сообщение
     * @param type {TypeSearch} Платформа на которой искали
     * @requires {ParsingTimeToString}
     */
    function ArrayToString(results: InputTrack[], message: ClientMessage, type: TypeSearch): string {
        let NumberTrack = 1, StringTracks;

        // @ts-ignore
        results.ArraySort(15).forEach((tracks: InputTrack[]) => StringTracks = tracks.map((track) => {
            const Duration = type === "YOUTUBE" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds)); //Проверяем надо ли конвертировать время
            const NameTrack = `[${message.client.replaceText(track.title, 80, true)}]`; //Название трека
            const DurationTrack = `[${Duration ?? "LIVE"}]`; //Длительность трека
            const AuthorTrack = `[${message.client.replaceText(track.author.title, 12, true)}]`; //Автор трека

            return `${NumberTrack++} ➜ ${DurationTrack} | ${AuthorTrack} | ${NameTrack}`;
        }).join("\n"));

        return StringTracks;
    }
}