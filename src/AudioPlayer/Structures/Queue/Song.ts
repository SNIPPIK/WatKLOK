import { platform, Platform } from "../Platform";
import { DownloadManager } from "@Structures/Media/Uploader";
import { ClientMessage } from "@Client/interactionCreate";
import { DurationUtils } from "@Structures/Durations";
import { httpsClient } from "@httpsClient";
import { Music } from "@db/Config.json";

export { Song, inAuthor, inPlaylist, inTrack };
//====================== ====================== ====================== ======================

/**
 * @description Создаем трек для внутреннего использования
 */
class Song {
    readonly #title: string;
    readonly #url: string;
    readonly #author: inAuthor;
    readonly #duration: { seconds: number, full: string };
    readonly #image: inTrack["image"];
    readonly #requester: SongRequester;
    readonly #isLive: boolean;
    readonly #color: number;
    readonly #platform: platform;

    #resLink: string;

    public constructor(track: inTrack, author: ClientMessage["author"]) {
        const { username, id, avatar } = author;

        const platform = Platform.name(track.url);
        const seconds = parseInt(track.duration.seconds);

        this.#title = track.title;
        this.#url = track.url;
        this.#author = {
            url: !track.author?.url || track.author?.url === "" ? Music.images._image : track.author.url,
            title: !track.author?.title || track.author?.title === "" ? "Not found track name" : track.author.title,
            image: !track.author?.image || track.author?.image?.url === "" ? { url: Music.images._image } : track.author.image,
            isVerified: track.author?.isVerified ?? undefined
        };
        this.#duration = { seconds, full: seconds > 0 ? DurationUtils.ParsingTimeToString(seconds) : "Live" };
        this.#image = !track.image || track.image?.url === "" ? { url: Music.images._image } : track.image;
        this.#requester = { username, id, avatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp` };
        this.#isLive = track.isLive;
        this.#color = Platform.color(platform);
        this.#platform = platform;
        this.#resLink = track?.format?.url;
    };

    //Название трека
    public get title() { return this.#title; };
    //Ссылка на трек
    public get url() { return this.#url; };
    //Автор трека
    public get author() { return this.#author; };
    //Время трека
    public get duration() { return this.#duration; };
    //Картинки трека
    public get image() { return this.#image; };
    //Пользователь включивший трек
    public get requester() { return this.#requester; };
    //Этот трек потоковый
    public get isLive() { return this.#isLive; };
    //Цвет трека
    public get color() { return this.#color; };
    //Тип трека
    public get platform() { return this.#platform; };

    public get link() { return this.#resLink; };
    private set link(url: string) { this.#resLink = url; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходник трека
     * @param seek {number} До скольки пропускаем трек
     */
    public resource = (seek: number): Promise<string> => {
        return new Promise((resolve) => {
            //Если пользователь включил кеширование музыки
            if (CacheMusic) {
                const info = DownloadManager.getNames(this);

                //Если есть файл выдаем путь до него
                if (info.status === "final") return resolve(info.path);
            }

            //Проверяем ссылку на работоспособность
            return findSong.checkingLink(this.link, seek, this).then((url: string) => {
                if (!url) return resolve(null);

                //Если включено кеширование музыки то скачиваем
                if (CacheMusic) setImmediate(() => DownloadManager.download(this, url));

                this.link = url;
                return resolve(url);
            });
        });
    };
}

const CacheMusic = Music.CacheMusic;
//====================== ====================== ====================== ======================
/*                             Namespace for find url resource                             */
//====================== ====================== ====================== ======================
namespace findSong {
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходник трека
     * @param seek {number} До скольки пропускаем трек
     * @param req {number} Кол-во повторных запросов (не менять)
     */
    export function checkingLink(url: string, seek: number, song: Song, req = 0): Promise<string> {
        return new Promise(async (resolve) => {
            if (req > 3) return resolve(null);

            //Если нет ссылки, то ищем трек
            if (!url) url = await getLink(song);

            //Проверяем ссылку на работоспособность
            const status = await httpsClient.checkLink(url);

            //Если ссылка работает
            if (status === "OK") return resolve(url);

            //Если ссылка не работает, то удаляем ссылку и делаем новый запрос
            req++;
            return resolve(checkingLink(null, seek, song, req));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    function getLink({ platform, url, author, title, duration }: Song): Promise<string> {
        if (!Platform.noAudio(platform)) {
            const callback = Platform.callback(platform, "track");

            //Если нет такой платформы или нет callbacks.track
            if (typeof callback === "string") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<inTrack>).then((track: inTrack) => track?.format?.url);
        }
        //Ищем трек
        let track = searchTracks(`${author.title} ${title}`, duration.seconds, platform);

        //Если трек не найден пробуем 2 вариант без автора
        if (!track) track = searchTracks(title, duration.seconds, platform);

        return track;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на yandex music, если нет токена yandex music или yandex зажмотил ссылку то ищем на YouTube
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @param platform {platform} Платформа
     */
    function searchTracks(nameSong: string, duration: number, platform: platform): Promise<string> {
        const exPlatform = Platform.isFailed(platform) || Platform.noAudio(platform) ? Platform.isFailed("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const callbacks = Platform.full(platform).callbacks;

        return callbacks.search(nameSong).then((tracks: inTrack[]) => {
            //Фильтруем треки оп времени
            const FindTrack: inTrack = tracks.find((track: inTrack) => {
                const DurationSong: number = (exPlatform === "YOUTUBE" ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (!FindTrack) return null;

            //Получаем данные о треке
            return callbacks.track(FindTrack.url).then((video: inTrack) => video?.format?.url) as Promise<string>;
        });
    }
}


//====================== ====================== ====================== ======================
/**
 * @description Какие данные доступны в <song>.requester
 * @type interface
 */
interface SongRequester {
    id: string;
    username: string;
    avatarURL: () => string | null;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого трека
 * @type interface
 */
interface inTrack {
    title: string;
    url: string;
    duration: { seconds: string; };
    image?: { url: string; height?: number; width?: number };
    author: {
        title: string;
        url: string | null;
        image?: { url: string | null; width?: number; height?: number; };
        isVerified?: boolean;
    },
    format?: { url: string | null };
    isLive?: boolean;
    PrevFile?: string;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого автора трека
 * @type interface
 */
interface inAuthor {
    title: string;
    url: string | undefined;
    image?: { url: string | undefined; width?: number; height?: number; };
    isVerified?: boolean;
}
//====================== ====================== ====================== ======================
/**
 * @description Пример получаемого плейлиста
 * @type interface
 */
interface inPlaylist {
    url: string;
    title: string;
    items: inTrack[];
    image: { url: string; };
    author?: inAuthor;
}