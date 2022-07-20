import {Command} from "../Constructor";
import {ApplicationCommandOptionType, StageChannel, VoiceChannel} from "discord.js";
import {ClientMessage} from "../../Core/Client";
import {Queue} from "../../Core/Player/Structures/Queue/Queue";
import {Searcher} from "../../Core/Player/Structures/Resource/Searcher";

const youtubeStr = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
const spotifySrt = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
const SoundCloudSrt = /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/;
const UrlSrt = /^(https?:\/\/)/gi;

export class CommandPlay extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з"],
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",

            permissions: {client: ["Speak", "Connect"], user: []},
            options: [
                {
                    name: "url-name-type",
                    description: "Укажи что нужно, ссылку, название или тип поиска и название",
                    required: true,
                    type: ApplicationCommandOptionType.String
                },
                {
                    name: "search",
                    description: "Прошлый аргумент, тип? Если да, тут название трека!",
                    required: false,
                    type: ApplicationCommandOptionType.String
                }
            ],
            enable: true,
            slash: true,
            CoolDown: 8
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): void => {
        const voiceChannel: VoiceChannel | StageChannel = message.member.voice.channel;
        const queue: Queue = message.client.queue.get(message.guild.id);
        const search: string = args.join(" ");

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id) return message.client.Send({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`,
            message,
            color: "RED"
        });

        //Если пользователь не подключен к голосовым каналам
        if (!voiceChannel || !message.member.voice) return message.client.Send({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: "RED"
        });

        //Если пользователь не указал аргумент
        if (!search && !message.attachments?.last()?.url) return message.client.Send({
            text: `${message.author}, Укажи ссылку, название или прикрепи файл!`,
            message,
            color: "RED"
        });

        try {
            //Отправляем сообщение о поиске трека
            message.client.Send({ text: `🔍 | Поиск -> ${search}`, message, color: "RED", type: "css" });

            const TypeSearch = this.#typeSong(search);
            const Platform = this.#PlatformSong(search, message);
            const Search = TypeSearch === "search" && search?.match(Platform) ? search.split(Platform)[1] : search;

            return Searcher.toPlayer({
                type: TypeSearch,
                platform: Platform,
                message, voiceChannel,
                search: Platform === "ds" ? message.attachments?.last()?.url : Search
            })
        } catch (e) {
            console.log(`[Command: Play]: ${e}`);
            return message.client.Send({
                text: `${message.author.username} | Произошла ошибка: ${e}`,
                message,
                color: "RED",
                type: "css"
            });
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Независимо от платформы делаем проверку типа ссылки
     * @param search {string} Что там написал пользователь
     * @private
     */
    readonly #typeSong = (search: string) => {
        if (!search) return "track"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(/v=/) && search.match(/list=/)) return "change";
        else if (search.match(/playlist/)) return "playlist";
        else if (search.match(/album/) || search.match(/sets/)) return "album";
        else if (search.match(UrlSrt)) return "track";
        return "search";
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем инициалы платформы
     * @param search {string} Что там написал пользователь
     * @param message {ClientMessage} Сообщение
     * @private
     */
    readonly #PlatformSong = (search: string, message: ClientMessage): "yt" | "sp" | "vk" | "sc" | "ds" => {
        if (!search) return "ds"; //Если нет search, значит пользователь прикрепил файл

        if (search.match(UrlSrt)) {
            if (search.match(youtubeStr)) return "yt";
            else if (search.match(spotifySrt)) return "sp";
            else if (search.match(/vk.com/)) return "vk";
            else if (search.match(SoundCloudSrt)) return "sc";
            else if (search.match(/cdn.discordapp.com/) || message.attachments?.last()?.url) return "ds";
        }

        const SplitSearch = search.split(' ');
        const FindType = SplitSearch[0].toLowerCase();

        if (FindType.length > 2) return "yt";
        return FindType as any;
    };
}