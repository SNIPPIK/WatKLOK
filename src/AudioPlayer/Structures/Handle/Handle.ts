import {StageChannel, VoiceChannel} from "discord.js";
import {FailRegisterPlatform, SearchPlatforms, SupportPlatforms, supportPlatforms, SupportType, TypePlatform} from "../SongSupport";
import {ClientInteraction, ClientInteractive, ClientMessage, messageUtils} from "../../../Handler/Events/Activity/interactionCreate";
import {InputPlaylist, InputTrack} from "../Queue/Song";
import {DurationUtils} from "../../Managers/DurationUtils";
import {replacer, ResolveData} from "../../../Structures/Handle/Command";


//Данные которые необходимо передать для поиска
interface Options {
    type?: SupportType
    platform?: supportPlatforms
    search: string
    message: ClientInteractive
    voiceChannel: VoiceChannel | StageChannel
}

const UrlSrt = /^(https?:\/\/)/gi;
const emoji = "❌";

export namespace Handle {
    /**
     * @description Ищем и передаем в плеер данные
     * @param options {Options} Параметры
     */
    export function toPlayer(options: Options): void {
        const {search, message, voiceChannel} = options;
        const type = HandleUtils.typeSong(search); //Тип запроса
        const platform = HandleUtils.PlatformSong(search, message); //Платформа с которой будем взаимодействовать
        const parsedSearch = HandleUtils.findArg(search, platform, type); //Правит ошибку с некоторыми ссылками

        //Если нельзя получить данные с определенной платформы
        if (FailRegisterPlatform.has(platform)) return messageUtils.sendMessage({
            text: `${message.author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`,
            message, color: "DarkRed", codeBlock: "css"
        });

        const findPlatform = SupportPlatforms[platform]; //Ищем в списке платформу
        const findType = (findPlatform as any)[type]; //Ищем тип запроса

        if (!findPlatform) return messageUtils.sendMessage({ text: `${message.author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "DarkRed", message });
        else if (!findType) return messageUtils.sendMessage({ text: `${message.author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!`, color: "DarkRed", message });

        const runCallback = findType(parsedSearch) as Promise<InputTrack | InputPlaylist | InputTrack[]>;

        runCallback.then((data: InputTrack | InputPlaylist | InputTrack[]) => {
            if (!data) return messageUtils.sendMessage({ text: `${message.author}, данные не были найдены!`, color: "Yellow", message });

            //Если пользователь ищет трек
            if (data instanceof Array) return SearchSongMessage.toSend(data, data.length, {...options, platform, type});

            //Сообщаем что трек был найден
            if (type === "track") messageUtils.sendMessage({text: `Найден 🔍 | ${type}\n➜ ${data.title}`, message, color: "Yellow", codeBlock: "css"});

            //Загружаем трек или плейлист в GuildQueue
            return message.client.player.emit("play", message as any, voiceChannel, data);
        });
        //Если выходит ошибка
        runCallback.catch((err) => messageUtils.sendMessage({ text: `${message.author}, данные не были найдены!\nПричина: ${err}`, color: "DarkRed", message }));
    }
}

//====================== ====================== ====================== ======================
/**
 * @description Функции для Searcher<toPlayer>
 */
namespace HandleUtils {
    /**
     * @description Независимо от платформы делаем проверку типа ссылки
     * @param search {string} Что там написал пользователь
     */
    export function typeSong(search: string) {
        if (!search) return "track"; //Если нет search, значит пользователь прикрепил файл

        //Если ссылка, то это может быть плейлист, альбом или просто трек
        if (search.match(UrlSrt)) {
            if (search.match(/playlist/)) return "playlist";
            else if (search.match(/album/) || search.match(/sets/)) return "album";
            return "track";
        }
        return "search";
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем инициалы платформы
     * @param search {string} Что там написал пользователь
     * @param message {ClientInteractive} Сообщение
     */
    export function PlatformSong(search: string, message: ClientInteractive): supportPlatforms {
        if (!search) return "DISCORD"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(UrlSrt)) return TypePlatform(search);
        const SplitSearch = search.split(' ');
        const platform = SplitSearch[0] as "yt" | "vk" | "sp" | "sc";

        if (SearchPlatforms[platform]) return SearchPlatforms[platform] as supportPlatforms;
        return "YOUTUBE";
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Фильтруем ссылку от аргументов поиска
     * @param arg {string} аргументы переданные пользователем
     * @param platform {supportPlatforms} Платформа
     * @param type {SupportType} Тип запроса
     */
    export function findArg(arg: string, platform: supportPlatforms, type: SupportType): string {
        if (arg.match(UrlSrt)) return `http${arg.split("http")[1]}`; //Если строка ссылка
        else if (type === "search" && arg.includes(platform)) return arg.split(platform)[1]; //Если строка это поиск на определенной платформе
        return arg;
    }
}
//====================== ====================== ====================== ======================
/**/
//Сообщение о поиске треков
namespace SearchSongMessage {
    /**
     * @description Отправляем сообщение о том что удалось найти
     * @param results {any[]} Результаты поиска
     * @param num {number} Кол-во найденных треков
     * @param options {Options}
     * @requires {Reaction, deleteMessage}
     */
    export function toSend(results: InputTrack[], num: number, options: Options): ResolveData {
        const {message, platform} = options;

        if (results.length < 1) return { text: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed" };

        const ConstFind = `Выбери от 1 до ${results.length}`; //Показываем сколько есть треков в списке
        const Requester = `[Платформа: ${platform} | Запросил: ${message.author.username}]`; //Показываем платформу и того кто запросил
        const SongsString = ArrayToString(results, message, platform);
        const callback = (msg: ClientMessage) => {
            //Создаем сборщик
            const collector = messageUtils.createCollector(message as ClientMessage, (m) => {
                const messageNum = parseInt(m.content);
                return !isNaN(messageNum) && messageNum <= num && messageNum > 0 && m.author.id === message.author.id;
            });

            //Делаем что-бы при нажатии на эмодзи удалялся сборщик
            messageUtils.createReaction(msg, emoji,
                (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id,
                () => {
                    messageUtils.deleteMessage(msg, 1e3); //Удаляем сообщение
                    collector?.stop();
                },
                30e3
            );

            //Что будет делать сборщик после нахождения числа
            collector.once("collect", (m: any): void => {
                setImmediate(() => {
                    [msg, m].forEach(messageUtils.deleteMessage); //Удаляем сообщения, бота и пользователя
                    collector?.stop(); //Уничтожаем сборщик

                    //Получаем ссылку на трек, затем включаем его
                    const url = results[parseInt(m.content) - 1].url;
                    return Handle.toPlayer({...options, type: "track", search: url});
                });
            });
        }

        if ("commandName" in message) (message as ClientInteraction).reply({content: `\`\`\`css\n${ConstFind}\n${Requester}\n\n${SongsString}\n\`\`\``, fetchReply: true}).then(callback);
        else (message as ClientMessage).channel.send({content: `\`\`\`css\n${ConstFind}\n${Requester}\n\n${SongsString}\n\`\`\``, }).then(callback);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Собираем найденные треки в <string>
     * @param results {any[]} Результаты поиска
     * @param message {ClientInteractive} Сообщение
     * @param platform {supportPlatforms} Платформа на которой искали
     * @requires {ParsingTimeToString}
     */
    function ArrayToString(results: InputTrack[], message: ClientInteractive, platform: supportPlatforms): string {
        let NumberTrack = 1, StringTracks;

        // @ts-ignore
        results.ArraySort(15).forEach((tracks: InputTrack[]) => StringTracks = tracks.map((track) => {
            const Duration = platform === "YOUTUBE" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds)); //Проверяем надо ли конвертировать время
            const NameTrack = `[${replacer.replaceText(track.title, 80, true)}]`; //Название трека
            const DurationTrack = `[${Duration ?? "LIVE"}]`; //Длительность трека
            const AuthorTrack = `[${replacer.replaceText(track.author.title, 12, true)}]`; //Автор трека

            return `${NumberTrack++} ➜ ${DurationTrack} | ${AuthorTrack} | ${NameTrack}`;
        }).join("\n"));

        return StringTracks;
    }
}