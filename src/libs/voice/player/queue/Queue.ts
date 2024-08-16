import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "@lib/voice/player";
import {Client} from "@lib/discord";
import {Voice} from "@lib/voice";
import {Song} from "./Song";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Список очередей для работы плеера
 * @class Queue
 * @public
 */
export class Queue {
    private readonly _data = {
        repeat:     "off" as "off" | "song" | "songs",
        shuffle:    false as boolean,

        message:    null as Client.message,
        voice:      null as VoiceChannel | StageChannel,
        player:     null as AudioPlayer
    };
    private readonly _components = [
        { type: 2, emoji: {id: db.emojis.button.shuffle},   custom_id: 'shuffle',       style: 2 },  //Shuffle
        { type: 2, emoji: {id: db.emojis.button.pref},      custom_id: 'last',          style: 2 },  //Last song
        { type: 2, emoji: {id: db.emojis.button.pause},     custom_id: 'resume_pause',  style: 2 },  //Resume/Pause
        { type: 2, emoji: {id: db.emojis.button.next},      custom_id: 'skip',          style: 2 },  //Skip song
        { type: 2, emoji: {id: db.emojis.button.loop},      custom_id: 'repeat',        style: 2 }   //Loop
    ];
    private readonly _songs = new QueueSongs();

    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get songs() { return this._songs; };

    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        if (this.shuffle) Object.assign(this._components[0], {style: 1});
        else Object.assign(this._components[0], {style: 2});

        //Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(this._components[2], {emoji: {id: db.emojis.button.resume}});
        else Object.assign(this._components[2], {emoji: {id: db.emojis.button.pause}});

        if (this.repeat === "song") Object.assign(this._components[4], { emoji: {id: db.emojis.button.loop_one}, style: 1 });
        else if (this.repeat === "songs") Object.assign(this._components[4],{ emoji: {id: db.emojis.button.loop}, style: 1 });
        else Object.assign(this._components[4],{ emoji: {id: db.emojis.button.loop}, style: 2 });

        return {type: 1, components: this._components};
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean { return this._data.shuffle; };

    /**
     * @description Сохраняем данные перетасовки
     * @param bol - Параметр boolean
     * @public
     */
    public set shuffle(bol) { this._data.shuffle = bol; };

    /**
     * @description Сохраняем тип повтора
     * @param loop - Тип повтора
     * @public
     */
    public set repeat(loop: "off" | "song" | "songs") { this._data.repeat = loop; };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() { return this._data.repeat; };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() { return this._data.message; };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice(): VoiceChannel | StageChannel { return this._data.voice; };

    /**
     * @description Выдаем сервер к которому привязана очередь
     * @return Guild
     * @public
     */
    public get guild() { return this.message.guild; };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() { return this._data.player; };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message: Client.message) { this._data.message = message; };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice {VoiceChannel} Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: VoiceChannel | StageChannel) {
        this._data.voice = voice;
        this.player.connection = Voice.join({
            selfDeaf: true,
            selfMute: false,

            guildId: this.guild.id,
            channelId: voice.id
        }, this.guild.voiceAdapterCreator);
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param options - Опции для создания очереди
     * @public
     */
    public constructor(options: { voice: VoiceChannel | StageChannel; message: Client.message; }) {
        const ID = options.message.guildId;

        // Создаем плеер
        this._data.player = new AudioPlayer(ID);

        // В конце функции выполнить запуск проигрывания
        setImmediate(() => {
            this.player.play(this.songs.song);
        });

        // Добавляем данные в класс
        for (const [key, value] of Object.entries(options)) {
            try {
                this[key] = value;
            } catch {
                throw TypeError(`Error in queue, ${key} is not found in the server queue`);
            }
        }

        // Добавляем очередь в список очередей
        db.audio.queue.set(ID, this);
    };

    /**
     * @description Проверяем надо ли создать очередь и добавляем треки в нее
     * @param message - Сообщение пользователя
     * @param voice   - Голосовой канал
     * @param item    - Добавляемый объект
     */
    public static startUp = (message: Client.message, voice: VoiceChannel | StageChannel, item: any) => {
        let queue = db.audio.queue.get(message.guild.id);

        // Проверяем есть ли очередь в списке
        if (!queue) queue = new Queue({message, voice});

        // Отправляем сообщение о том что было добавлено
        if (item instanceof Song && queue.songs.size >= 1) db.audio.queue.events.emit("message/push", queue, item);
        else if ("items" in item) db.audio.queue.events.emit("message/push", message, item);

        // Добавляем треки в очередь
        for (const track of (item["items"] ?? [item]) as Song[]) {
            track.requester = message.author;
            queue.songs.push(track);
        }
    };

    /**
     * @description Очищаем очередь
     * @public
     */
    public cleanup = () => {
        db.audio.cycles.players.remove(this.player);
        this.player.cleanup();

        for (let item of Object.keys(this._data)) this._data[item] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Создаем Array с треками для очереди
 * @class QueueSongs
 * @private
 */
class QueueSongs extends Array<Song> {
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
}