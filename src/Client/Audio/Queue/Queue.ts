import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {AudioPlayer} from "@Client/Audio/Stream/AudioPlayer";
import {StageChannel, VoiceChannel} from "discord.js";
import {joinVoiceChannel} from "@discordjs/voice";
import {Duration} from "@Client/Audio";
import {Song} from "./Song";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description Локальная база с данными
 * @const db
 */
const db = {
    emoji: {
        resume: env.get("button.resume"),
        pause: env.get("button.pause"),
        loop: env.get("button.loop"),
        loop_one: env.get("button.loop_one"),
        pref: env.get("button.pref"),
        next: env.get("button.next"),
        queue: env.get("button.queue")
    }
};


/**
 * @author SNIPPIK
 * @description Данные очереди
 * @class initQueueSystem
 * @abstract
 */
abstract class initQueueSystem {
    private readonly _recorded: { msg: ClientMessage, voice: VoiceChannel | StageChannel } = { msg: null, voice: null };
    private readonly _player = new AudioPlayer();

    /**
     * @description Получаем плеер текущей очереди
     * @public
     */
    public get player() { return this._player; };

    /**
     * @description Взаимодействуем с голосовым каналом
     * @public
     */
    public set voice(voice: VoiceChannel | StageChannel) {
        this._recorded.voice = voice;
        this.player.connection = joinVoiceChannel({
            selfDeaf: true, guildId: this.guild.id, channelId: voice.id,
            adapterCreator: this.guild.voiceAdapterCreator
        });
    };
    public get voice() { return this._recorded.voice; };

    /**
     * @description Получаем данные сервера
     * @public
     */
    public get guild() { return this.message?.guild ?? undefined; };

    /**
     * @description Взаимодействуем с сообщением
     * @public
     */
    public set message(message) { this._recorded.msg = message; };
    public get message() { return this._recorded.msg; };
}



/**
 * @author SNIPPIK
 * @description Класс очереди для проигрывания треков
 * @class ArrayQueue
 */
export class ArrayQueue extends initQueueSystem {
    private readonly _options: { loop: "off" | "song" | "songs" } = { loop: "off" };
    private readonly _songs = new Songs();
    public constructor(msg: ClientMessage, voice: VoiceChannel | StageChannel) {
        super();
        this.message = msg;
        this.voice = voice;
    };

    /**
     * @description Получаем класс с треками
     * @public
     */
    public get songs() { return this._songs; }

    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        let components = [
            { type: 2, emoji: {id: db.emoji.queue}, custom_id: 'queue', style: 2 }, { type: 2, emoji: {id: db.emoji.pref}, custom_id: 'last', style: 2 }
        ];

        //Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "pause") components.push({ type: 2, emoji: {id: db.emoji.resume}, custom_id: 'resume_pause', style: 2 });
        else components.push({ type: 2, emoji: {id: db.emoji.pause}, custom_id: 'resume_pause', style: 2 });

        components.push({ type: 2, emoji: {id: db.emoji.next}, custom_id: 'skip', style: 2 });

        //Делаем проверку на кнопку REPEAT
        if (this.options.loop === "song") components.push({ type: 2, emoji: {id: db.emoji.loop_one}, custom_id: 'repeat', style: 1 });
        else if (this.options.loop === "songs") components.push({ type: 2, emoji: {id: db.emoji.loop}, custom_id: 'repeat', style: 1 });
        else components.push({ type: 2, emoji: {id: db.emoji.loop}, custom_id: 'repeat', style: 2 });

        return { type: 1, components };
    };

    /**
     * @description Получаем настройки очереди
     * @public
     */
    public get options() { return this._options; };
}



/**
 * @author SNIPPIK
 * @description Создаем Array с треками для очереди
 * @class QueueSongs
 */
class Songs extends Array<Song> {
    /**
     * @description Получаем текущий трек
     */
    public get song(): Song { return this.at(0); };

    /**
     * @description Получаем последний трек в очереди
     */
    public get last(): Song { return this.at(-1); };

    /**
     * @description Кол-во треков в очереди
     */
    public get size(): number { return this.length; };

    /**
     * @description Общее время треков
     */
    public get time() { return Duration.getTimeArray(this as Array<Song>); };
}