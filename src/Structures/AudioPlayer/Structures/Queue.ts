import {Collection, StageChannel} from "discord.js";
import {ClientMessage} from "@Client/Message";
import {Debug, Music} from "@db/Config.json";
import {OpusAudio} from "./Media/OpusAudio";
import {AudioPlayer} from "./AudioPlayer";
import {MessagePlayer} from "./Messages";
import {Voice} from "@Utils/Voice";
import {ISong, Song} from "./Song";
import {Logger} from "@Logger";

/**
 * @description Collection Queue, содержит в себе все очереди
 */
export class CollectionQueue extends Collection<string, Queue> {
    /**
     * @description Записываем очередь в this
     */
    private set setQueue(queue: Queue) {
        //Запускаем callback для проигрывания треков
        setImmediate(() => queue.play = 0);

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

        if (Debug) Logger.debug(`[Queue]: [${queue.guild.id}]: has create`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очереди или добавляем в нее объект или объекты
     */
    public set create(options: { message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist }) {
        const { message, VoiceChannel, info } = options;
        const queue = this.get(message.guild.id);

        if (!queue) {
            //Создаем очередь
            const GuildQueue = new Queue(message, VoiceChannel);

            //Подключаемся к голосовому каналу
            GuildQueue.player.connection = Voice.Join(VoiceChannel); //Добавляем подключение в плеер

            this.setQueue = GuildQueue;
        }

        //Добавляем плейлист или трек в очередь
        this.addTracks = { queueID: message.guild.id, info };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем трек или плейлист
     */
    private set addTracks(options: { queueID: string, info: ISong.track | ISong.playlist }) {
        const queue = this.get(options.queueID);
        const info = options.info;
        const { message } = queue;
        const requester = message.author;

        //Загружаем плейлисты или альбомы
        if ("items" in info) {
            //Отправляем сообщение о том что плейлист будет добавлен в очередь
            MessagePlayer.toPushPlaylist(message, info);

            //Загружаем треки из плейлиста в очередь
            for (let track of info.items) queue.songs.push(new Song(track, requester));
            return;
        }

        //Добавляем трек в очередь
        const song = new Song(info, requester);
        if (queue.songs.length >= 1) MessagePlayer.toPushSong(queue, song);

        queue.songs.push(song);
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Очередь сервера
 */
export class Queue {
    /**
     * @description Таймер удаления, нужен для авто удаления очереди
     */
    public _timer: NodeJS.Timeout = null;
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
     * @description Создаем поток и передаем его в плеер
     */
    public set play(seek: number) {
        //Если треков в очереди больше нет
        if (!this.song) { this.cleanup(); return; }

        //Отправляем сообщение с авто обновлением
        if (!seek || !this.filters.length) MessagePlayer.toPlay(this.message);

        //Запускаем чтение потока
        this.song.resource.then((url) => {
            if (!url) { this.player.emit("error", Error(`[${this.song.url}] Link to resource, not found`), true); return; }

            //Отправляем поток в плеер
            this.player.readStream = new OpusAudio(url, {seek, filters: this.song.options.isLive ? [] : this.filters});
        }).catch((e) => this.player.emit("error", Error(e), true));

        //Если включен режим отладки показывает что сейчас играет и где
        if (Debug) Logger.debug(`[Queue]: [${this.guild.id}]: Play: [${this.song.duration.full}] - [${this.song.author.title} - ${this.song.title}]`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаление очереди через время
     * @param state {string} Что делать с очередью. Запуск таймера или отмена
     * @constructor
     */
    public set timer(state: "start" | "cancel") {
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
     * @description Меняет местами треки
     * @param num {number} Если есть номер для замены
     */
    public set swap(num: number) {
        if (this.songs.length === 1) {
            this.player.stop();
            return;
        }

        const first = this.songs[0];
        const position = num ?? this.songs.length - 1;

        this.songs[0] = this.songs[position];
        this.songs[position] = first;
        this.player.stop();
    };
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
            if (this?.options?.random) this.swap = Math.floor(Math.random() * this.songs.length);

            //Включаем трек
            setTimeout(() => this.play = 0, 1500);
        });

        //Если в плеере возникнет ошибка
        this.player.on("error", (err, isSkip) => {
            //Выводим сообщение об ошибке
            MessagePlayer.toError(this, err);

            setTimeout((): void => {
                if (isSkip) {
                    this.songs.shift();
                    setTimeout(() => this.play = 0, 1e3);
                }
            }, 1200);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем не используемые объекты
     */
    public readonly cleanup = (): void => {
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