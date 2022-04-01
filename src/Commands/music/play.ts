import {Command} from "../Constructor";
import {MessageCollector, ReactionCollector, StageChannel, VoiceChannel} from "discord.js";
import {ClientMessage} from "../../Core/Client";
import {Spotify, VK, YouTube} from "../../Core/Platforms";
import {Queue} from "../../Core/Player/Queue/Structures/Queue";
import {InputPlaylist, InputTrack} from "../../Core/Utils/TypeHelper";
import {ParserTimeSong} from "../../Core/Player/Manager/Functions/ParserTimeSong";

const youtubeStr = /^(https?:\/\/)?(www\.)?(m\.)?(music\.)?( )?(youtube\.com|youtu\.?be)\/.+$/gi;
const spotifySrt = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;

export class CommandPlay extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з"],
            description: 'Воспроизведение плейлиста по URL или по названию музыки',

            permissions: {client: ['Speak', 'Connect'], user: []},
            options: [
                {
                    name: "song-or-type",
                    description: "Song (url, name) - (YouTube, Spotify, VK) or search type - (yt, sp, vk)",
                    required: true,
                    type: "STRING"
                },
                {
                    name: "search",
                    description: "Name song. (YouTube, Spotify, VK)",
                    required: false,
                    type: "STRING"
                }
            ],
            enable: true,
            slash: true,
            CoolDown: 8
        })
    };

    public run = async (message: ClientMessage, args: string[]): Promise<void | boolean | string | MessageCollector> => {
        const voiceChannel: VoiceChannel | StageChannel = message.member.voice.channel, search: string = args.join(' '),
            queue: Queue = message.client.queue.get(message.guild.id);

        if (queue && queue.channels.voice && message.member.voice.channel.id !== queue.channels.voice.id) return message.client.Send({
            text: `${message.author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.channels.voice.id}>`,
            message,
            color: 'RED'
        });

        if (!voiceChannel || !message.member.voice) return message.client.Send({
            text: `${message.author}, Подключись к голосовому каналу!`,
            message,
            color: 'RED'
        });

        if (!search) return message.client.Send({
            text: `${message.author}, Укажи ссылку, название!`,
            message,
            color: "RED"
        });

        return CommandPlay.getInfoPlatform(search, message, voiceChannel).catch(async (e: Error | string) => {
            console.log(`[PlayCommand]: [ERROR] -> `, e);
            return message.client.Send({
                text: `${message.author.username} | Произошла ошибка: ${e}`, message, color: "RED", type: "css"
            });
        });
    };
    //Выбираем платформу
    protected static getInfoPlatform = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean | MessageCollector> => {
        if (search.match(youtubeStr)) return this.PlayYouTube(message, search, voiceChannel);
        else if (search.match(spotifySrt)) return this.PlaySpotify(message, search, voiceChannel);
        else if (search.match(/vk.com/)) return this.PlayVK(message, search, voiceChannel);
        const SplitSearch = search.split(' ');
        const SearchType = SplitSearch[0].toLowerCase();

        if (SearchType === 'sp') {
            delete SplitSearch[0];
            return new HandleInfoResource().SP_SearchTracks(message, voiceChannel, SplitSearch.join(' '));
        } else if (SearchType === 'vk') {
            delete SplitSearch[0];
            return new HandleInfoResource().VK_SearchTracks(SplitSearch.join(' '), message, voiceChannel);
        }

        return new HandleInfoResource().YT_SearchVideos(message, voiceChannel, search);
    };
    //Для системы youtube
    protected static PlayYouTube = async (message: ClientMessage, search: string, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => {
        if (search.match(/v=/) && search.match(/list=/)) return new HandleInfoResource().ChangeRes(message, search, voiceChannel);
        if (search.match(/playlist/)) return new HandleInfoResource().YT_getPlaylist(search, message, voiceChannel);
        return new HandleInfoResource().YT_getVideo(search, message, voiceChannel);
    };
    //Для системы spotify
    protected static PlaySpotify = async (message: ClientMessage, search: string, voiceChannel: VoiceChannel | StageChannel): Promise<void| boolean> => {
        if (search.match(/playlist/)) return new HandleInfoResource().SP_getPlaylist(search, message, voiceChannel);
        if (search.match(/album/)) return new HandleInfoResource().SP_getAlbum(search, message, voiceChannel);
        return new HandleInfoResource().SP_getTrack(search, message, voiceChannel);
    };
    //Для системы VK
    protected static PlayVK = async (message: ClientMessage, search: string, voiceChannel: VoiceChannel | StageChannel): Promise<void| boolean> => {
        if (search.match(/playlist/)) return new HandleInfoResource().VK_getPlaylist(search, message, voiceChannel);
        return new HandleInfoResource().VK_getTrack(search, message, voiceChannel);
    };
}

class HandleInfoResource {
    //Для поиска музыки
    protected collector: MessageCollector = null;
    protected type: "yt" | "sp" | "vk" = null;

    //YouTube (youtube.com) взаимодействие с youtube
    public YT_getVideo = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => YouTube.getVideo(search).then(async (video: InputTrack) => !video ? message.client.Send({text: `${message.author}, Хм, YouTube не хочет делится данными! Существует ли это видео вообще!`, message: message, color: 'RED'}) : this.runPlayer(video, message, voiceChannel));
    public YT_getPlaylist = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => YouTube.getPlaylist(search).then(async (playlist: InputPlaylist) => !playlist ? message.client.Send({text: `${message.author}, Хм, YouTube не хочет делится данными! Существует ли это плейлист вообще!`, message: message, color: 'RED'}) : this.runPlaylistSystem(message, playlist, voiceChannel));
    public YT_SearchVideos = async (message: ClientMessage, voiceChannel: VoiceChannel | StageChannel, searchString: string): Promise<void | MessageCollector> => {
        this.type = "yt";
        return YouTube.SearchVideos(searchString).then(async (result: InputTrack[]) => this.SendMessage(message, result, voiceChannel, await this.ArraySort(result, message), result.length));
    };

    //Spotify (open.spotify.com) взаимодействие с spotify
    public SP_getTrack = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => Spotify.getTrack(search).then(async (track: InputTrack) => !track?.isValid ? message.client.Send({text: `Хм, Spotify не хочет делится данными! Существует ли это трек вообще!`, message: message, color: 'RED'}) : this.runPlayer(track, message, voiceChannel));
    public SP_getPlaylist = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => Spotify.getPlaylist(search).then(async (playlist: InputPlaylist) => !playlist?.title ? message.client.Send({text: `${message.author}, Хм, Spotify не хочет делится данными! Существует ли это плейлист вообще!`, message: message, color: 'RED'}) : this.runPlaylistSystem(message, playlist, voiceChannel));
    public SP_getAlbum = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => Spotify.getAlbum(search).then(async (playlist: InputPlaylist) => !playlist?.title ? message.client.Send({text: `${message.author}, Хм, Spotify не хочет делится данными! Существует ли это альбом вообще!`, message: message, color: 'RED'}) : this.runPlaylistSystem(message, playlist, voiceChannel));
    public SP_SearchTracks = async (message: ClientMessage, voiceChannel: VoiceChannel | StageChannel, searchString: string): Promise<void | MessageCollector> => {
        this.type = "sp";
        return Spotify.SearchTracks(searchString).then(async (result) => this.SendMessage(message, result?.items, voiceChannel, await this.ArraySort(result?.items, message), result.items?.length));
    };

    //VK (vk.com) взаимодействие с vk
    public VK_getTrack = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => VK.getTrack(search).then(async (track: InputTrack) => !track ? message.client.Send({text: `Хм, Vk не хочет делится данными! Существует ли это трек вообще!`, message: message, color: 'RED'}) : this.runPlayer(track, message, voiceChannel));
    public VK_getPlaylist = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | boolean> => VK.getPlaylist(search).then(async (playlist: InputPlaylist) => !playlist ? message.client.Send({text: `${message.author}, Хм, Vk не хочет делится данными! Существует ли это плейлист вообще!`, message: message, color: 'RED'}) : this.runPlaylistSystem(message, playlist, voiceChannel));
    public VK_SearchTracks = async (search: string, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<void | MessageCollector> => {
        this.type = "vk";
        return VK.SearchTracks(search).then(async (result) => this.SendMessage(message, result?.items, voiceChannel, await this.ArraySort(result?.items, message), result?.items?.length));
    };

    //Создаем сборщик для выбора плейлиста или трека
    public ChangeRes = async (message: ClientMessage, search: string, voiceChannel: VoiceChannel | StageChannel) => message.channel.send(`\`\`\`css\nЯ обнаружил в этой ссылке, видео и плейлист. Что включить\n\n1️⃣ - Включить плейлист\n2️⃣ - Включить видео\`\`\``).then(async (msg) => {
        await this.Reaction(msg, message, "1️⃣", async () => {
            await this.deleteMessage(msg as any);
            return this.YT_getPlaylist(search, message, voiceChannel);
        });
        await this.Reaction(msg, message, "2️⃣", async () => {
            await this.deleteMessage(msg as any);
            return this.YT_getVideo(search, message, voiceChannel);
        });

        setTimeout(async () => {
            await this.deleteMessage(msg as any);
            await this.deleteMessage(message);
            return this.collector?.stop();
        }, 10e3);
    })

    //Какое перенаправление делаем в систему плейлистов или просто добавим трек?
    protected runPlayer = async (video: InputTrack, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<boolean> => void message.client.player.emit('play', message, voiceChannel, video);
    protected runPlaylistSystem = async (message: ClientMessage, playlist: InputPlaylist, voiceChannel: VoiceChannel | StageChannel): Promise<boolean> => void message.client.player.emit('playlist', message, playlist, voiceChannel);

    //Создаем сборщик для поиска треков
    protected ArraySort = async (results: any, message: ClientMessage): Promise<string> => {
        let num = 1, resp;
        results.ArraySort(15).forEach((s: any) => resp = s.map((video: InputTrack) => (`${num++} ➜ [${this.ConvertTimeSearch(video.duration.seconds) ?? "LIVE"}] [${message.client.ConvertedText(video.author.title, 12, true)}] [${message.client.ConvertedText(video.title, 80, true)}]`)).join(`\n`));
        return resp === undefined ? `😟 Похоже ${this.isType()} не хочет делится поиском!` : resp;
    };
    protected SendMessage = async (message: ClientMessage, results: any[], voiceChannel: VoiceChannel | StageChannel, resp: string, num: number): Promise<MessageCollector> => message.channel.send(`\`\`\`css\nВыбери от 1 до ${results.length}\n[Платформа: ${this.isType()} | Запросил: ${message.author}]\n\n${resp}\`\`\``).then(async (msg: any) => {
        this.Reaction(msg, message, "❌", () => (this.collector?.stop(), this.deleteMessage(msg))).catch((err: Error) => console.log(err));
        await this.MessageCollector(msg, message, num);
        return this.CollectorCollect(msg, results, message, voiceChannel);
    });
    //Добавляем к коллектору ивент сбора
    protected CollectorCollect = async (msg: ClientMessage, results: any[], message: ClientMessage, voiceChannel: VoiceChannel | StageChannel): Promise<MessageCollector> => this.collector.once('collect', async (m: any): Promise<any> => {
        await this.deleteMessage(msg);
        await this.deleteMessage(m);
        this.collector.stop();
        return this.pushSong(results, m, message, voiceChannel);
    });
    //Из типа выдает поиск трека
    protected pushSong = async (results: any[], m: ClientMessage, message: ClientMessage, voiceChannel: VoiceChannel | StageChannel) => {
        if (this.type === "sp") return this.SP_getTrack(results[parseInt(m.content) - 1].url, message, voiceChannel);
        else if (this.type === "vk") return this.VK_getTrack(results[parseInt(m.content) - 1].url, message, voiceChannel);
        return this.YT_getVideo(results[parseInt(m.content) - 1].url, message, voiceChannel);
    };
    //Удаляем сообщение
    protected deleteMessage = async (msg: ClientMessage): Promise<NodeJS.Timeout> => setTimeout(async () => msg.delete().catch(() => null), 1000);
    //Добавляем реакцию (эмодзи)
    protected Reaction = async (msg: ClientMessage | any, message: ClientMessage, emoji: string, callback: any): Promise<ReactionCollector> => msg.react(emoji).then(async () => msg.createReactionCollector({filter: async (reaction: any, user: any) => (reaction.emoji.name === emoji && user.id !== message.client.user.id), max: 1}).once('collect', () => callback()));
    //Создаем коллектор (discord.js) для обработки сообщений от пользователя
    protected MessageCollector = async (msg: ClientMessage, message: ClientMessage, num: any): Promise<any> => this.collector = msg.channel.createMessageCollector({filter: async (m: any) => !isNaN(m.content) && m.content <= num && m.content > 0 && m.author.id === message.author.id, max: 1});
    //Тип поиска
    protected isType = () => this.type === "sp" ? "SPOTIFY" : this.type === "yt" ? "YOUTUBE" : this.type === "vk" ? "VK" : undefined;
    //Конвертируем время в 00:00
    protected ConvertTimeSearch = (duration: string) => {
        if (this.type === 'yt') return duration;
        return ParserTimeSong(parseInt(duration));
    };
}