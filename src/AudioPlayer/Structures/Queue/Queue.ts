import {ClientMessage} from "@Client/interactionCreate";
import {PlayerEvents} from "@Structures/Player/Events";
import {MessagePlayer} from "@Structures/Messages";
import {inPlaylist, inTrack, Song} from "./Song";
import {Balancer} from "@Structures/Balancer";
import {consoleTime} from "@Client/Client";
import {StageChannel} from "discord.js";
import {Debug} from "@db/Config.json";
import {AudioPlayer} from "../Player";
import {OpusAudio} from "@OpusAudio";
import {Voice} from "@VoiceManager";

export {toQueue, Queue};
//====================== ====================== ====================== ======================

/**
 * @description Добавляем плейлист или трек в очередь
 * @param message {ClientMessage} Сообщение с сервера
 * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
 * @param info {inTrack | inPlaylist} Входные данные это трек или плейлист?
 * @requires {CreateQueue}
 */
function toQueue(message: ClientMessage, VoiceChannel: Voice.Channels, info: inTrack | inPlaylist): void {
    const {queue, status} = CreateQueue(message, VoiceChannel);
    const requester = message.author;

    setImmediate(() => {
        //Если поступает плейлист
        if ("items" in info) {
            MessagePlayer.toPushPlaylist(message, info);
            //Добавляем треки в очередь
            info.items.forEach((track: inTrack) => Balancer.push(() => queue.push(new Song(track, requester))));
        } else queue.push(new Song(info, requester), queue.songs.length >= 1); //Добавляем трек в очередь

        //Запускаем callback плеера, если очередь была создана, а не загружена!
        if (status === "create") queue.play();
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем очереди или если она есть выдаем
 * @param message {ClientMessage} Сообщение с сервера
 * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
 */
function CreateQueue(message: ClientMessage, VoiceChannel: Voice.Channels): { status: "create" | "load", queue: Queue } {
    const {client, guild} = message;
    const queue = client.queue.get(guild.id);

    if (queue) return {queue, status: "load"};

    //Создаем очередь
    const GuildQueue = new Queue(message, VoiceChannel);
    
    //Подключаемся к голосовому каналу
    GuildQueue.player.voice = Voice.Join(VoiceChannel); //Добавляем подключение в плеер
    client.queue.set(guild.id, GuildQueue); //Записываем очередь в <client.queue>

    return {queue: GuildQueue, status: "create"};
}
//====================== ====================== ====================== ======================

/**
 * @description Музыкальная очередь, создается для каждого сервера
 */
class Queue {
    //====================== ====================== ====================== ======================
    /**
     * @description Таймер удаления
     * @private
     */
    private Timer: NodeJS.Timeout = null; //Таймер для авто удаления очереди
    //====================== ====================== ====================== ======================
    /**
     * @description Удалять ли очереди из-за истечения таймера
     * @private
     */
    private hasDestroying: boolean = false; //Статус удаления (запущено ли удаление)
    //====================== ====================== ====================== ======================
    /**
     * @description Array<Song> база с треками
     * @private
     */
    private _songs: Array<Song> = []; //Все треки находятся здесь
    public get songs() { return this._songs; };
    public set songs(songs) { this._songs = songs; };

    //Текущий трек
    public get song(): Song {
        if (this._songs?.length < 1) return null;

        return this.songs[0];
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Плеер
     * @private
     */
    private _player: AudioPlayer = new AudioPlayer(); //Сам плеер
    //Данные плеера
    public get player() { return this._player; };
    //====================== ====================== ====================== ======================
    /**
     * @description Каналы для взаимодействия. Каналы (message: TextChannel, voice: VoiceChannel)
     * @private
     */
    private channels: { message: ClientMessage, voice: Voice.Channels | StageChannel };
    //Голосовой канал
    public get voice() { return this.channels.voice; };
    public set voice(voiceChannel) { this.channels.voice = voiceChannel; };

    //Сообщение
    public get message() { return this.channels.message; };
    public set message(message) { this.channels.message = message; };

    //Сервер для которого создана очередь
    public get guild() { return this.message.guild; };
    //====================== ====================== ====================== ======================
    /**
     * @description Настройки для очереди. Включен лы повтор, включен ли режим радио
     * @private
     */
    private _options: { random: boolean, loop: "song" | "songs" | "off", radioMode: boolean } = { //Уникальные настройки
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        radioMode: false //Режим радио
    };
    //Настройки
    public get options() { return this._options; };
    //====================== ====================== ====================== ======================
    /**
     * @description Все включенные фильтры
     * @private
     */
    private _filters: Array<string> | Array<string | number> = [];  //Фильтры для FFmpeg
    public get filters() { return this._filters; };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очередь для сервера
     * @param message {ClientMessage} Сообщение с сервера
     * @param voice {Voice.Channels} Голосовой канал
     */
    public constructor(message: ClientMessage, voice: Voice.Channels) {
        this.channels = {message, voice};

        this.player.on("idle", () => PlayerEvents.onIdlePlayer(this));
        this.player.on("error", (err, isSkip) => PlayerEvents.onErrorPlayer(err, this, isSkip));
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем трек в очередь
     * @param song {Song} Трек
     * @param sendMessage {boolean} Отправить сообщение о добавлении трека
     */
    public push = (song: Song, sendMessage: boolean = false): void => {
        if (sendMessage) MessagePlayer.toPushSong(this, song);

        this.songs.push(song);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Включение текущего трека
     * @param seek {number} До скольки надо перемотать трек
     */
    public play = (seek: number = 0): Promise<void> | void => {
        //Если треков в очереди больше нет
        if (!this.song) return this.cleanup();

        setImmediate(() => {
            //Отправляем сообщение с авто обновлением
            if (!seek) MessagePlayer.toPlay(this.message);

            //Если включен режим отладки показывает что сейчас играет и где
            if (Debug) consoleTime(`[Debug] -> Play: ${this.guild.id}: ${this.song.title}`);

            const resource = this.song.resource(seek);

            resource.then((url: string) => {
                //Если ссылка не была найдена
                if (!url) return void this.player.emit("error", Error(`Link to resource, not found`), true);

                //Создаем поток
                const stream = new OpusAudio(url, {seek, filters: this.song.isLive ? [] : this.filters});

                //Отправляем поток в плеер
                return this.player.readStream(stream);
            });
            //Если получение ссылки вызывает ошибку
            resource.catch((err) => this.player.emit("error", Error(err), true));
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Меняет местами треки
     * @param num {number} Если есть номер для замены
     */
    public swapSongs = (num?: number): void => {
        if (this.songs.length === 1) return this.player.stop();

        swapPositions<Song>(this.songs, num ?? this.songs.length - 1);
        this.player.stop();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем не используемые объекты
     */
    public cleanup = (): void => {
        const message = this.message;
        const {client, guild} = message;

        if (message && message?.deletable) message?.delete().catch(() => undefined);

        //Удаляем таймер
        clearTimeout(this.Timer);

        if (this._player) {
            this.player.destroy();

            delete this._player;
        }

        delete this._songs;
        delete this._filters;
        delete this._options;
        delete this.channels;
        delete this.Timer;
        delete this.hasDestroying;

        client.queue.delete(guild.id);
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
        if (state === "start" && this.hasDestroying) {
            this.Timer = setTimeout(this.cleanup, 20e3);
            player.pause(); this.hasDestroying = true;
        } else clearTimeout(this.Timer); this.hasDestroying = false;
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Смена позиции в Array
 * @param array {Array<any>} Array
 * @param position {number} Номер позиции
 */
function swapPositions<V>(array: V[], position: number): void {
    const first = array[0];
    array[0] = array[position];
    array[position] = first;
}