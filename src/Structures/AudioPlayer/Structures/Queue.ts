import { DownloadManager } from "../Plugins/Download";
import { Platform, platform } from "../Platform";
import { DurationUtils } from "@Utils/Durations";
import { PlayerEvents } from "./Player/Events";
import { OpusAudio } from "./Media/OpusAudio";
import { MessagePlayer } from "./Messages";
import { AudioPlayer } from "./Player";
import { Song, ISong } from "./Song";
import { Voice } from "./Voice";

import { ClientMessage } from "@Client/Message";
import { Debug, Music } from "@db/Config.json";
import { httpsClient } from "@httpsClient";
import { StageChannel } from "discord.js";
import { Logger } from "@Logger";

/**
 * @description Очередь сервера
 */
export class Queue {
    /**
     * @description Таймер удаления, нужен для авто удаления очереди
     */
    private _timer: NodeJS.Timeout = null;
    //====================== ====================== ====================== ======================
    /**
     * @description Array<Song> база с треками
     */
    private _songs: Array<Song> = [];
    //====================== ====================== ====================== ======================
    /**
     * @description Все включенные фильтры. Фильтры для FFmpeg
     */
    private _filters: Array<string> | Array<string | number> = [];
    //====================== ====================== ====================== ======================
    /**
     * @description Плеер
     */
    private _player: AudioPlayer = new AudioPlayer();
    //====================== ====================== ====================== ======================
    /**
     * @description Каналы для взаимодействия. Каналы (message: TextChannel, voice: VoiceChannel)
     */
    private _channel: { msg: ClientMessage, voice: Voice.Channels | StageChannel };
    //====================== ====================== ====================== ======================
    /**
     * @description Настройки для очереди. Включен лы повтор, включен ли режим радио
     */
    private _options: { random: boolean, loop: "song" | "songs" | "off", radioMode: boolean } = {
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        radioMode: false //Режим радио
    };
    //====================== ====================== ====================== ======================
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем все треки
     */
    public get songs() { return this._songs; };
    //====================== ====================== ====================== ======================
    /**
     * @description Заменяем треки
     */
    public set songs(songs) { this._songs = songs; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем текущий трек
     */
    public get song(): Song { return this._songs?.length < 1 ? null : this.songs[0]; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем плеер текущей очереди
     */
    public get player() { return this._player; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем голосовой канал
     */
    public get voice() { return this._channel.voice; };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняем голосовой канал
     */
    public set voice(voiceChannel) { this._channel.voice = voiceChannel; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем сообщение из базы
     */
    public get message() { return this._channel.msg; };
    //====================== ====================== ====================== ======================
    /**
     * @description Записываем сообщение в базу
     */
    public set message(message) { this._channel.msg = message; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные сервера
     */
    public get guild() { return this.message?.guild ?? undefined; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем все включенные фильтры
     */
    public get filters() { return this._filters; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем настройки очереди
     */
    public get options() { return this._options; };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очередь для сервера
     * @param msg {ClientMessage} Сообщение с сервера
     * @param voice {Voice.Channels} Голосовой канал
     */
    public constructor(msg: ClientMessage, voice: Voice.Channels) {
        this._channel = { msg, voice };

        this.player.on("idle", () => PlayerEvents.onIdle(this));
        this.player.on("error", (err, isSkip) => PlayerEvents.onError(err, this, isSkip));
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Включение текущего трека
     * @param seek {number} До скольки надо перемотать трек
     */
    public play = (seek: number = 0): Promise<void> | void => {
        const song = this.song;

        //Если треков в очереди больше нет
        if (!song) return this.cleanup();

        setImmediate((): void => {
            //Отправляем сообщение с авто обновлением
            if (!seek) MessagePlayer.toPlay(this.message);

            new Promise<string>((resolve) => {
                //Если пользователь включил кеширование музыки
                if (Music.CacheMusic) {
                    const info = DownloadManager.getNames(song);

                    //Если есть файл выдаем путь до него
                    if (info.status === "final") return resolve(info.path);
                }

                //Проверяем ссылку на работоспособность
                return findSong.checkingLink(song.link, song).then((url: string) => {
                    if (!url) return resolve(null);

                    //Если включено кеширование музыки то скачиваем
                    if (Music.CacheMusic) setImmediate(() => DownloadManager.download(song, url));

                    song.link = url;
                    return resolve(url);
                });
            }).then((url: string) => {
                //Если ссылка не была найдена
                if (!url) return void this.player.emit("error", Error(`Link to resource, not found`), true);

                //Создаем поток
                const stream = new OpusAudio(url, { seek, filters: this.song.options.isLive ? [] : this.filters });

                //Отправляем поток в плеер
                return this.player.readStream(stream);

                //Если получение ссылки вызывает ошибку
            }).catch((err: string) => this.player.emit("error", Error(err), true));

            //Если включен режим отладки показывает что сейчас играет и где
            if (Debug) {
                if (!seek && !this.filters.length) Logger.debug(`[Queue]: [${this.guild.id}]: Play: [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
                else Logger.debug(`[Queue]: [${this.guild.id}]: Play: [seek: ${seek} | filters: ${this.filters.length}] | [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
            }
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняет местами треки
     * @param num {number} Если есть номер для замены
     */
    public swapSongs = (num?: number): void => {
        if (this.songs.length === 1) return this.player.stop();

        const first = this.songs[0];
        const position = num ?? this.songs.length - 1;

        this.songs[0] = this.songs[position];
        this.songs[position] = first;
        this.player.stop();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаление очереди через время
     * @param state {string} Что делать с очередью. Запуск таймера или отмена
     * @constructor
     */
    public TimeDestroying = (state: "start" | "cancel"): void => {
        const player = this.player;

        //Запускаем таймер по истечению которого очереди будет удалена!
        if (state === "start" && !this._timer) {
            this._timer = setTimeout(this.cleanup, 10e3);
            player.pause();
        } else {
            player.resume();
            clearTimeout(this._timer);
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем не используемые объекты
     */
    public cleanup = (): void => {
        const message = this.message;
        const { client, guild } = message;

        if (message && message?.deletable) message?.delete().catch(() => undefined);

        //Удаляем таймер
        clearTimeout(this._timer);

        if (this._player) {
            //Удаляем плеер и его данные
            this.player.destroy("stream");
            this.player.destroy("all");
            this._player = null;
        }

        this._songs = null;
        this._filters = null;
        this._options = null;
        this._channel = null;
        this._timer = null;

        client.player.queue.delete(guild.id);

        if (Music.LeaveInEnd) Voice.Disconnect(message.guild.id);
        if (Debug) Logger.debug(`[Queue]: [${message.guild.id}]: has deleted`);
    };
}
//====================== ====================== ====================== ======================
/*                             Namespace for find url resource                             */
//====================== ====================== ====================== ======================
namespace findSong {
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходник трека
     * @param req {number} Кол-во повторных запросов (не менять)
     */
    export function checkingLink(url: string, song: Song, req = 0): Promise<string> {
        return new Promise(async (resolve) => {
            if (req > 3) return resolve(null);

            //Если нет ссылки, то ищем трек
            if (!url) url = await getLink(song);

            //Проверяем ссылку на работоспособность
            const check = await httpsClient.checkLink(url);

            //Если ссылка работает
            if (check) return resolve(url);

            //Если ссылка не работает, то удаляем ссылку и делаем новый запрос
            req++;
            return resolve(checkingLink(null, song, req));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    function getLink({ platform, url, author, title, duration }: Song): Promise<string> {
        if (!Platform.isAudio(platform)) {
            const callback = Platform.callback(platform, "track");

            //Если нет такой платформы или нет callbacks.track
            if (typeof callback === "string") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<ISong.track>).then((track: ISong.track) => track?.format?.url);
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
        const exPlatform = Platform.isFailed(platform) || Platform.isAudio(platform) ? Platform.isFailed("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const callbacks = Platform.full(exPlatform).requests;

        const seacrh = callbacks.find((req) => req.type === "search");
        const track = callbacks.find((req) => req.type === "track");

        return (seacrh.run(nameSong) as Promise<ISong.track[]>).then((tracks: ISong.track[]) => {
            //Фильтруем треки оп времени
            const FindTracks: ISong.track[] = tracks.filter((track: ISong.track) => {
                const DurationSong: number = (exPlatform === "YOUTUBE" ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return (track.run(FindTracks[0].url) as Promise<ISong.track>).then((video: ISong.track) => video?.format?.url) as Promise<string>;
        });
    }
}