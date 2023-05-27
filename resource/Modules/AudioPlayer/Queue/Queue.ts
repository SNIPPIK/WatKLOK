import {OpusAudio} from "@AudioPlayer/Audio/Media/OpusAudio";
import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "../Audio/AudioPlayer";
import {TypedEmitter} from "tiny-typed-emitter";
import {ClientMessage} from "@Client/Message";
import {PlayerMessage} from "../Message";
import {Logger} from "@Logger";
import {Song} from "./Song";
import {env} from "@env";

/**
 * @description Часть отвечающая за таймер и ивенты
 */
class Timer extends TypedEmitter<TimerEvents> {
    /**
     * @description Таймер удаления, нужен для авто удаления очереди
     */
    private _timer: NodeJS.Timeout = null;

    /**
     * @description Удаление очереди через время
     * @param state {string} Что делать с очередью. Запуск таймера или отмена
     * @constructor
     */
    public set state(state: "start" | "cancel" | "destroy") {
        if (state === "cancel") {
            clearTimeout(this._timer);
            this.emit("cancel");
            return;
        } else if (state === "destroy") {
            clearTimeout(this._timer);
            return;
        }

        //Запускаем таймер по истечению которого очереди будет удалена!
        this._timer = setTimeout(() => this.emit("start"), 10e3);
    };
}

/**
 * @description Часть отвечающая за базу данных
 */
class Queue_Base extends Timer {
    /**
     * @description Array<Song> база с треками
     */
    protected _songs: Array<Song> = [];

    //====================== ====================== ====================== ======================

    /**
     * @description Все включенные фильтры. Фильтры для FFmpeg
     */
    protected _filters: Array<string> | Array<string | number> = [];

    //====================== ====================== ====================== ======================

    /**
     * @description Плеер
     */
    protected _player: AudioPlayer = new AudioPlayer();

    //====================== ====================== ====================== ======================

    /**
     * @description Каналы для взаимодействия. Каналы (message: TextChannel, voice: VoiceChannel)
     */
    protected _channel: { msg: ClientMessage, voice: VoiceChannel | StageChannel };

    //====================== ====================== ====================== ======================

    /**
     * @description Настройки для очереди. Включен лы повтор, включен ли режим радио
     */
    protected _options: { random: boolean, loop: "song" | "songs" | "off", radioMode: boolean } = {
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        radioMode: false //Режим радио
    };
}

/**
 * @description Часть отвечающая за get, set
 */
class Queue_Functions extends Queue_Base {
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
     * @description Меняет местами треки
     * @param num {number} Если есть номер для замены
     */
    public set swap(num: number) {
        if (this.songs.length === 1) { this.player.stop; return; }

        const first = this.songs[0];
        const position = num ?? this.songs.length - 1;

        this.songs[0] = this.songs[position];
        this.songs[position] = first;
        this.player.stop;
    };
}

/**
 * @description Часть отвечающая за callback
 */
export class Queue extends Queue_Functions {
    /**
     * @description Создаем поток и передаем его в плеер
     */
    public set play(seek: number) {
        //Если треков в очереди больше нет
        if (!this.song) { this.emit("destroy"); return; }

        //Отправляем сообщение с авто обновлением
        if (seek === 0) PlayerMessage.toPlay(this);

        //Запускаем чтение потока
        this.song.resource.then((url) => {
            if (!url) { this.player.emit("error", Error(`[${this.song.url}] не найдена ссылка на исходный файл!`), true); return; }

            //Отправляем поток в плеер
            this.player.readStream = new OpusAudio(url, {seek, filters: this.song.options.isLive ? [] : this.filters});
        }).catch((e) => this.player.emit("error", Error(e), true));

        //Если включен режим отладки показывает что сейчас играет и где
        if (env.get("debug.client")) Logger.debug(`[Queue]: [${this.guild.id}]: Play: [${this.song.duration.full}] - [${this.song.author.title} - ${this.song.title}]`);
    };

    /**
     * @description Создаем очередь для сервера
     * @param msg {ClientMessage} Сообщение с сервера
     * @param voice {VoiceChannel | StageChannel} Голосовой канал
     */
    public constructor(msg: ClientMessage, voice: VoiceChannel | StageChannel) {
        super();
        this._channel = { msg, voice };
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