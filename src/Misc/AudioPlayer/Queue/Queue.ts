import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "../Audio/AudioPlayer";
import {ClientMessage} from "@Client/Message";
import {TypedEmitter} from "@Emitter";
import {PlayerMessage} from "../Message";
import {OpusAudio} from "../Audio/Opus";
import {Voice} from "@Util/Voice";
import {Logger} from "@Logger";
import {Song} from "./Song";
import {env} from "@env";

const timeDestroy = parseInt(env.get("music.queue.destroy"));

class QueueTimer extends TypedEmitter<TimerEvents> {
    protected _timeout: NodeJS.Timeout = null;
    /**
     * @description Удаление очереди через время
     * @param state {string} Что делать с очередью. Запуск таймера или отмена
     * @constructor
     */
    public set state(state: "start" | "cancel" | "destroy") {
        if (this._timeout) clearTimeout(this._timeout);

        if (state === "cancel" || state === "destroy") {
            this.emit(state);
            return;
        }

        //Запускаем таймер по истечению которого очереди будет удалена!
        this._timeout = setTimeout(() => this.emit("destroy"), timeDestroy * 1e3);
    };
}

class QueueBase extends QueueTimer {
    protected _songs: Array<Song> = [];
    protected _player: AudioPlayer = new AudioPlayer();
    protected _filters: Array<string> | Array<string | number> = [];
    protected _channel: { msg: ClientMessage, voice: VoiceChannel | StageChannel } = null;
    protected _options: { random: boolean, loop: "song" | "songs" | "off", radioMode: boolean } = {
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        radioMode: false //Режим радио
    };
}

class QueueFunctions extends QueueBase {
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
     * @description Записываем сообщение в базу или удаляем его
     */
    public set message(message) {
        //Если нет сообщения или канал нового и старого совпадают, то удаляем
        if (!message && this._channel.msg?.delete) {
            this._channel.msg.delete().catch(() => undefined);
            return;
        }

        this._channel.msg = message;
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
export class Queue extends QueueFunctions {
    /**
     * @description Создаем поток и передаем его в плеер
     */
    public set play(seek: number) {
        //Если треков в очереди больше нет
        if (!this.song) { this.emit("destroy"); return; }

        //Отправляем сообщение с авто обновлением
        if (seek === 0) PlayerMessage.toPlay(this);

        //Получаем ссылку на файл
        this.song.resource.then((path) => {
            //Если не удалось получить рабочую ссылку
            if (!path) { this.player.emit("error", Error(`[${this.song.url}] не найдена ссылка на исходный файл!`), true); return; }

            //Отправляем поток в плеер, если это сделать не удалось пропускаем трек
            try {
                this.player.exportStreamPlayer = new OpusAudio({ path, seek, filters: this.song.options.isLive ? [] : this.filters });
            } catch (e) { this.player.emit("error", e, true); }
        }).catch((e) => this.player.emit("error", Error(e), true));

        //Если включен режим отладки показывает что сейчас играет и где
        if (env.get("debug.player.audio")) Logger.debug(`Queue: Play: [${this.song.duration.full}] - [${this.song.author.title} - ${this.song.title}]`);
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
     * @description Создаем очередь для сервера
     * @param msg {ClientMessage} Сообщение с сервера
     * @param voice {VoiceChannel | StageChannel} Голосовой канал
     */
    public constructor(msg: ClientMessage, voice: VoiceChannel | StageChannel) {
        super();
        this._channel = { msg, voice };
        this.joinVoice = voice;
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