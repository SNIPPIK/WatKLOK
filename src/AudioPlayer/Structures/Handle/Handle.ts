import {FailRegisterPlatform, SearchPlatforms, SupportPlatforms, supportPlatforms, SupportType, TypePlatform} from "../SongSupport";
import {ClientInteractive, ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {replacer, ResolveData} from "@Structures/Handle/Command";
import {ArraySort} from "@Handler/Modules/Object/ArraySort";
import {InputPlaylist, InputTrack} from "@Queue/Song";
import {Message, StageChannel, VoiceChannel} from "discord.js";
import {DurationUtils} from "@Managers/DurationUtils";
import {ReactionMenuSettings} from "@db/Config.json";

//Данные которые необходимо передать для поиска
interface Options {
    type?: SupportType
    platform?: supportPlatforms
    search: string
    message: ClientInteractive
    voiceChannel: VoiceChannel | StageChannel
}

const UrlSrt = /^(https?:\/\/)/gi;
const emoji = ReactionMenuSettings.emojis.cancel;


export namespace Handle {
    /**
     * @description Ищем и передаем в плеер данные
     * @param options {Options} Параметры
     */
    export function toPlayer(options: Options): Promise<ResolveData> | ResolveData {
        const {search, message, voiceChannel} = options;
        const {client, author} = message;
        const type = IdentifyType.track(search); //Тип запроса
        const platform = IdentifyType.platform(search); //Платформа с которой будем взаимодействовать
        const parsedSearch = IdentifyType.Argument(search, type, platform); //Правит ошибку с некоторыми ссылками

        //Если нельзя получить данные с определенной платформы
        if (FailRegisterPlatform.has(platform)) return {
            text: `${author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`, color: "DarkRed", codeBlock: "css"
        };

        const findPlatform = SupportPlatforms[platform]; //Ищем в списке платформу
        const findType = (findPlatform as any)[type]; //Ищем тип запроса

        if (!findPlatform) return { text: `${author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "DarkRed" };
        else if (!findType) return { text: `${author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!`, color: "DarkRed" };

        const runCallback = findType(parsedSearch) as Promise<InputTrack | InputPlaylist | InputTrack[]>;

        //Если выходит ошибка
        runCallback.catch((err) => UtilsMsg.createMessage({ text: `${author}, данные не были найдены!\nПричина: ${err}`, color: "DarkRed", message }));

        return runCallback.then((data: InputTrack | InputPlaylist | InputTrack[]): ResolveData => {
            if (!data) return { text: `${author}, данные не были найдены!`, color: "Yellow"};

            //Если пользователь ищет трек
            if (data instanceof Array) return SearchMessage.toSend(data, {...options, platform, type});

            //Загружаем трек или плейлист в GuildQueue
            client.player.play(message as any, voiceChannel, data);

            //Сообщаем что трек был найден
            if (type === "track") return {text: `Найден 🔍 | ${type}\n➜ ${data.title}`, color: "Yellow", codeBlock: "css"};
        });
    }
}

namespace IdentifyType {
    /**
     * @description Независимо от платформы делаем проверку типа ссылки
     * @param search {string} Что там написал пользователь
     */
    export function track(search: string): SupportType {
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
     */
    export function platform(search: string) {
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
     * @param argument {string} аргументы переданные пользователем
     * @param platform {supportPlatforms} Платформа
     * @param type {SupportType} Тип запроса
     */
    export function Argument(argument: string, type: SupportType, platform: supportPlatforms) {
        if (argument.match(UrlSrt)) return `http${argument.split("http")[1]}`; //Если строка ссылка
        else if (type === "search" && argument.includes(platform)) return argument.split(platform)[1]; //Если строка это поиск на определенной платформе
        return argument;
    }
}

namespace SearchMessage {
    /**
     * @description Отправляем сообщение о том что удалось найти
     * @param results {InputTrack[]} Результаты поиска
     * @param options {Options}
     * @requires {Reaction, deleteMessage}
     */
    export function toSend(results: InputTrack[], options: Options): ResolveData {
        const {message, platform} = options;
        const {author, client} = message;

        if (results.length < 1) return { text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed" };

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
            const collector = UtilsMsg.createCollector(message.channel as any, (m) => {
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

            //Что будет делать сборщик после нахождения числа
            collector.once("collect", (m: any): void => {
                setImmediate(() => {
                    [msg, m].forEach(UtilsMsg.deleteMessage); //Удаляем сообщения, бота и пользователя
                    collector?.stop(); //Уничтожаем сборщик

                    //Получаем ссылку на трек, затем включаем его
                    const url = results[parseInt(m.content) - 1].url;
                    return Handle.toPlayer({...options, type: "track", search: url});
                });
            });
        };

        return {text: `${choice}\n${requester}\n\n${songsList}`, codeBlock: "css", notAttachEmbed: true, thenCallbacks: [callback]}
    }
}