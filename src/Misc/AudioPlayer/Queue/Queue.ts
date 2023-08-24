import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "../Audio/AudioPlayer";
import {ClientMessage} from "@Client/Message";
import {History} from "../Audio/History";
import {PlayerMessage} from "../Message";
import {TypedEmitter} from "@Emitter";
import {Voice} from "@Util/Voice";
import {Logger} from "@Logger";
import {Song} from "./Song";
import {env} from "@env";

const timeDestroy = parseInt(env.get("music.queue.destroy"));
export class Queue extends TypedEmitter<TimerEvents> {
    private _player: AudioPlayer = new AudioPlayer();
    private _timeout: NodeJS.Timeout = null;

    private _songs: Array<Song> = [];
    private _filters: Array<string> | Array<string | number> = [];

    private _channel: { msg: ClientMessage, voice: VoiceChannel | StageChannel };
    private _options = {
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        radioMode: false //Режим радио
    };
    public constructor(msg: ClientMessage, voice: VoiceChannel | StageChannel) { super(); this._channel = { msg, voice }; this.joinVoice = voice; };
    /**
     * @description Получаем все треки
     */
    public get songs() { return this._songs; };

    /**
     * @description Заменяем треки
     */
    public set songs(songs) { this._songs = songs; };

    /**
     * @description Получаем текущий трек
     */
    public get song(): Song { return this.songs.at(0); };

    /**
     * @description Получаем плеер текущей очереди
     */
    public get player() { return this._player; };

    /**
     * @description Получаем голосовой канал
     */
    public get voice() { return this._channel.voice; };

    /**
     * @description Меняем голосовой канал
     */
    public set voice(voiceChannel) { this._channel.voice = voiceChannel; };

    /**
     * @description Получаем сообщение из базы
     */
    public get message() { return this._channel.msg; };

    /**
     * @description Записываем сообщение в базу или удаляем
     */
    public set message(message) {
        if (message) { this._channel.msg = message; return; }

        //Если нет сообщения или канал нового и старого совпадают, то удаляем
        if (this._channel.msg && this._channel.msg?.deletable) this._channel.msg.delete().catch(() => undefined);
    };

    /**
     * @description Получаем данные сервера
     */
    public get guild() { return this.message?.guild ?? undefined; };

    /**
     * @description Получаем все включенные фильтры
     */
    public get filters() { return this._filters; };

    /**
     * @description Получаем настройки очереди
     */
    public get options() { return this._options; };

    /**
     * @description Меняет местами треки
     * @param num {number} Если есть номер для замены
     */
    public set swap(num: number) {
        if (this.songs.length > 1) {
            const index = num ?? this.songs.length - 1;

            this.songs[0] = this.songs[index];
            this.songs[index] = this.song;
        }

        //Пропускаем текущий трек
        this.player.stop;
    };


    /**
     * @description Создаем поток и передаем его в плеер
     */
    public set play(seek: number) {
        if (this.song) {
            this.song.resource.then((path) => {
                if (path instanceof Error) this.player.emit("error", path, false);

                //Отправляем данные в плеер для чтения если удалось получить ссылку или путь до файла
                else {
                    this.player.readStream = { path, seek, filters: this.song.options.isLive ? [] : this.filters };

                    setImmediate(() => {
                        if (seek === 0) {
                            //Отправляем сообщение с авто обновлением
                            PlayerMessage.toPlay(this);

                            //История треков сервера
                            try { if (History.enable) new History(this.song, this.guild.id, this.song.platform).init; } catch (e) { Logger.error(e) }
                        }
                    });
                }
            });
            return;
        }

        //Если нет треков, то удаляем очередь
        this.emit("destroy");
    };


    /**
     * @description Переподключение к голосовому каналу
     * @param voice {VoiceChannel | StageChannel} Голосовой канал
     */
    public set joinVoice(voice: VoiceChannel | StageChannel) {
        if (voice.id !== this.voice.id) this.voice = voice;
        this.player.connection = Voice.join(voice);
    };


    /**
     * @description Удаление очереди через время
     * @param state {string} Что делать с очередью. Запуск таймера или отмена
     * @constructor
     */
    public set state(state: "start" | "cancel" | "destroy") {
        if (this._timeout) clearTimeout(this._timeout);

        //Запускаем таймер по истечению которого очереди будет удалена!
        if (state === "start") this._timeout = setTimeout(() => this.emit("destroy"), timeDestroy * 1e3);

        //Отправляем ивент в EventEmitter
        this.emit(state);
    };
}

/**
 * @description Доступные ивенты
 */
interface TimerEvents {
    start: () => void;
    cancel: () => void;
    destroy: () => void;
}