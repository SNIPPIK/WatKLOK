import { MessagePlayer } from "./Messages";
import { AudioPlayer } from "./Player";
import { globalPlayer } from "@AudioPlayer";
import { Voice } from "./Voice";
import { Song } from "./Song";

import { ClientMessage } from "@Client/Message";
import { Debug, Music } from "@db/Config.json";
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
     * @description Запускаем проигрывание трека из текущей очереди
     */
    public get callback() { return (seek: number = 0) => globalPlayer.queue["playCallback"](this.guild.id, seek); };
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
            if (this?.songs) isRemoveSong(this); //Определяем тип loop

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
//====================== ====================== ====================== ======================
/**
 * @description Повтор музыки
 * @param queue {Queue} Очередь сервера
 */
function isRemoveSong({ options, songs }: Queue): void {
    const { radioMode, loop } = options;

    //Если включен радио мод или тип повтора трек нечего не делаем
    if (radioMode || loop === "song") return;

    //Убираем текущий трек
    const shiftSong = songs.shift();

    //Если тип повтора треки, то добавляем по новой трек
    if (loop === "songs") songs.push(shiftSong);
}