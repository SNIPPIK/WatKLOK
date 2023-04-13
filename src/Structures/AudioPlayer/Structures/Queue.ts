import { StageChannel, Collection } from "discord.js";
import { DownloadManager } from "../Plugins/Download";
import { httpsClient } from "@Structures/httpsClient";
import { ClientMessage } from "@Client/Message";
import { Debug, Music } from "@db/Config.json";
import { OpusAudio } from "./Media/OpusAudio";
import { AudioPlayer } from "./AudioPlayer";
import { MessagePlayer } from "./Messages";
import { Platform } from "../Platform";
import { Voice } from "@Utils/Voice";
import { Song, ISong } from "./Song";
import { Logger } from "@Logger";

/**
 * @description Collection Queue, содержит в себе все очереди
 */
export class CollectionQueue extends Collection<string, Queue> {
    /**
    * @description Создаем очереди или добавляем в нее обьект или обьекты
    * @param message {ClientMessage} Сообщение с сервера
    * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
    * @param info {ISong.track | ISong.playlist} Входные данные это трек или плейлист?
    * @requires {CreateQueue}
    */
    public create = (message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist): void => {
        const { queue, status } = this.createQueue(message, VoiceChannel);
        const requester = message.author;

        //Запускаем callback плеера, если очередь была создана, а не загружена!
        if (status === "create") setImmediate(() => this.playCallback(message.guild.id));

        //Зугружаем плейлисты или альбомы
        if ("items" in info) {
            //Отправляем сообщение о том что плейлист будет добавлен в очередь
            MessagePlayer.toPushPlaylist(message, info);

            //Зугрежаем треки из плейлиста в очередь
            for (let track of info.items) queue.songs.push(new Song(track, requester));
            return;
        }

        //Добавляем трек в очередь
        const song = new Song(info, requester);
        if (queue.songs.length >= 1) MessagePlayer.toPushSong(queue, song);

        queue.songs.push(song);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очереди или если она есть выдаем
     * @param message {ClientMessage} Сообщение с сервера
     * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
     */
    private createQueue = (message: ClientMessage, VoiceChannel: Voice.Channels): { status: "create" | "load", queue: Queue } => {
        const { client, guild } = message;
        const queue = client.player.queue.get(guild.id);

        if (queue) return { queue, status: "load" };

        //Создаем очередь
        const GuildQueue = new Queue(message, VoiceChannel);

        //Подключаемся к голосовому каналу
        GuildQueue.player.connection = Voice.Join(VoiceChannel); //Добавляем подключение в плеер
        client.player.queue.set(guild.id, GuildQueue); //Записываем очередь в <client.queue>

        return { queue: GuildQueue, status: "create" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запуск проигрывания трека
     * @param QueueID {string} Номер очереди или ID сервера
     * @param seek {number} До скольки надо пропустить
     */
    protected playCallback = (QueueID: string, seek: number = 0): void => {
        const queue = this.get(QueueID);
        const song = queue.song;

        //Если треков в очереди больше нет
        if (!song) return queue.cleanup();

        //Отправляем сообщение с авто обновлением
        if (!seek) MessagePlayer.toPlay(queue.message);

        //Получаем ссылку на исходный файл
        const resource = this.gettingResource(song);

        resource.then((url) => this.constructStream(queue, url, seek));
        resource.catch((err: string) => queue.player.emit("error", Error(err), true));

        //Если включен режим отладки показывает что сейчас играет и где
        if (Debug) {
            if (!seek && !queue.filters.length) Logger.debug(`[Queue]: [${QueueID}]: Play: [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
            else Logger.debug(`[Queue]: [${QueueID}]: Play: [seek: ${seek} | filters: ${queue.filters.length}] | [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем потоковое вещание при помощи FFmpeg и prism-media OggEncoder'a
     * @param queue {Queue} Очередь на которой будет запущено потоковое вещание
     * @param url {string} Ссылка или путь до файла
     * @param seek {number} До скольки пропускаем трек
     */
    private constructStream = (queue: Queue, url: string, seek: number = 0): void => {
        //Если ссылка не была найдена
        if (!url) return void queue.player.emit("error", Error(`Link to resource, not found`), true);

        //Создаем поток
        const stream = new OpusAudio(url, { seek, filters: queue.song.options.isLive ? [] : queue.filters });

        //Отправляем поток в плеер
        return queue.player.readStream(stream);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ссылку на исходный ресурс
     * @param song {Song} Какой трек буде включен
     */
    private gettingResource = (song: Song): Promise<string> => {
        return new Promise<string>((resolve) => {
            //Если пользователь включил кеширование музыки
            if (Music.CacheMusic) {
                const info = DownloadManager.getNames(song);

                //Если есть файл выдаем путь до него
                if (info.status === "final") return resolve(info.path);
            }

            //Проверяем ссылку на работоспособность
            this.checkingLink(song).then((url: string) => {
                //Если включено кеширование музыки то скачиваем
                if (Music.CacheMusic && url) setImmediate(() => DownloadManager.download(song, url));
                return resolve(url);
            });
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходник файл трека
     * @param song {Song} Трек который надо найти заново
     */
    private checkingLink = (song: Song, req = 0): Promise<string> => {
        return new Promise(async (resolve) => {
            if (req > 3) return resolve(null);

            //Если нет ссылки, то ищем трек
            if (!song.link) song.link = await Platform.searchResource(song);

            //Проверяем ссылку на работоспособность
            const check = await httpsClient.checkLink(song.link);

            //Если ссылка работает
            if (check) return resolve(song.link);

            //Если ссылка не работает, то удаляем ссылку и делаем новый запрос
            req++;
            return resolve(this.checkingLink(song, req));
        });
    };
}
//====================== ====================== ====================== ======================
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
    public get song(): Song { return this.songs.at(0); };
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
     * @description Запускаем проигрывание трека из текущей очереди
     */
    public get callback() { return (seek: number = 0) => this.message.client.player.queue["playCallback"](this.guild.id, seek); };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очередь для сервера
     * @param msg {ClientMessage} Сообщение с сервера
     * @param voice {Voice.Channels} Голосовой канал
     */
    public constructor(msg: ClientMessage, voice: Voice.Channels) {
        this._channel = { msg, voice };

        //Что будет делать плеер если закончит играть
        this.player.on("idle", () => {
            //Определяем тип loop
            if (this?.songs) {
                const { radioMode, loop } = this.options;

                //Если включен радио мод или тип повтора трек нечего не делаем
                if (radioMode || loop === "song") return;

                //Убираем текущий трек
                const shiftSong = this.songs.shift();

                //Если тип повтора треки, то добавляем по новой трек
                if (loop === "songs") this.songs.push(shiftSong);
            }

            //Выбираем случайный номер трека, просто меняем их местами
            if (this?.options?.random) {
                const RandomNumSong = Math.floor(Math.random() * this.songs.length)
                this.swapSongs(RandomNumSong);
            }

            //Включаем трек
            setTimeout(this.callback, 1500);
        });

        //Если в плеере возникнет ошибка
        this.player.on("error", (err, isSkip) => {
            //Выводим сообщение об ошибке
            MessagePlayer.toError(this, err);

            setTimeout((): void => {
                if (isSkip) {
                    this.songs.shift();
                    setTimeout(this.callback, 1e3);
                }
            }, 1200);
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