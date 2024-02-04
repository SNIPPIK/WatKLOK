import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {AudioPlayer} from "@Client/Audio/Player/AudioPlayer";
import {StageChannel, VoiceChannel} from "discord.js";
import {joinVoiceChannel} from "@discordjs/voice";
import {Duration} from "@Client/Audio";
import {db} from "@Client/db";
import {Song} from "./Song";
/**
 * @author SNIPPIK
 * @description Главный класс очереди
 * @class MusicQueue
 * @abstract
 */
abstract class MusicQueue {
    private readonly _local = {
        message:    null as ClientMessage,
        voice:      null as VoiceChannel | StageChannel,
        player:     new AudioPlayer()
    };
    /**
     * @description Выдаем сообщение
     * @return ClientMessage
     * @public
     */
    public get message(): ClientMessage {
        return this._local.message;
    };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice(): VoiceChannel | StageChannel {
        return this._local.voice;
    };

    /**
     * @description Выдаем сервер к которому привязана очередь
     * @return Guild
     * @public
     */
    public get guild() {
        return this.message.guild;
    };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() {
        return this._local.player;
    };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message {ClientMessage} Сохраняемое сообщение
     * @public
     */
    public set message(message: ClientMessage) {
        this._local.message = message;
    };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice {VoiceChannel} Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: VoiceChannel | StageChannel) {
        this._local.voice = voice;
        this.player.connection = joinVoiceChannel({
            selfDeaf: true, guildId: this.guild.id, channelId: voice.id,
            adapterCreator: this.guild.voiceAdapterCreator
        });
    };
}

/**
 * @author SNIPPIK
 * @description Создаем Array с треками для очереди
 * @class SongsQueue
 */
class SongsQueue extends Array<Song> {
    /**
     * @description Получаем текущий трек
     * @return Song
     * @public
     */
    public get song(): Song { return this.at(0); };

    /**
     * @description Получаем последний трек в очереди
     * @return Song
     * @public
     */
    public get last(): Song { return this.at(-1); };

    /**
     * @description Кол-во треков в очереди
     * @return number
     * @public
     */
    public get size(): number { return this.length; };

    /**
     * @description Общее время треков
     * @return string
     * @public
     */
    public get time() { return Duration.getTimeArray(this as Array<Song>); };
}

/**
 * @author SNIPPIK
 * @description Класс очереди для проигрывания треков
 * @class ArrayQueue
 */
export class ArrayQueue extends MusicQueue {
    private readonly _options = {
        loop: "off" as "off" | "song" | "songs",
        songs: new SongsQueue()
    };
    /**
     * @description Сохраняем тип повтора
     * @param loop {"off" | "song" | "songs"} Тип повтора
     * @public
     */
    public set loop(loop: "off" | "song" | "songs") {
        this._options.loop = loop;
    };

    /**
     * @description Получаем класс с треками
     * @public
     */
    public get songs() { return this._options.songs; }

    /**
     * @description Получаем настройки очереди
     * @public
     */
    public get loop() { return this._options.loop; };

    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        let components = [
            { type: 2, emoji: {id: db.emojis.button.queue}, custom_id: 'queue', style: 2 }, { type: 2, emoji: {id: db.emojis.button.pref}, custom_id: 'last', style: 2 }
        ];

        //Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "pause") components.push({ type: 2, emoji: {id: db.emojis.button.resume}, custom_id: 'resume_pause', style: 2 });
        else components.push({ type: 2, emoji: {id: db.emojis.button.pause}, custom_id: 'resume_pause', style: 2 });

        components.push({ type: 2, emoji: {id: db.emojis.button.next}, custom_id: 'skip', style: 2 });

        //Делаем проверку на кнопку REPEAT
        if (this.loop === "song") components.push({ type: 2, emoji: {id: db.emojis.button.loop_one}, custom_id: 'repeat', style: 1 });
        else if (this.loop === "songs") components.push({ type: 2, emoji: {id: db.emojis.button.loop}, custom_id: 'repeat', style: 1 });
        else components.push({ type: 2, emoji: {id: db.emojis.button.loop}, custom_id: 'repeat', style: 2 });

        return { type: 1, components };
    };

    public constructor(msg: ClientMessage, voice: VoiceChannel | StageChannel) {
        super();
        this.message = msg;
        this.voice = voice;
    };
}