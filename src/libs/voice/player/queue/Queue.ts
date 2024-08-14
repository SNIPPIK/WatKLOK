import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "@lib/voice/player";
import {Client} from "@lib/discord";
import {Voice} from "@lib/voice";
import {Song} from "./Song";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Главный класс очереди
 * @class BaseQueue
 * @abstract
 */
abstract class BaseQueue {
    private readonly data = {
        repeat:     "off" as "off" | "song" | "songs",
        shuffle:    false as boolean,

        message:    null as Client.message,
        voice:      null as VoiceChannel | StageChannel,
        player:     new class extends AudioPlayer {
            /**
             * @description Функция отвечает за циклическое проигрывание
             * @param track - Трек который будет включен
             * @param seek - Пропуск времени
             * @public
             */
            public play = (track: Song, seek: number = 0): void => {
                if (!track || !("resource" in track)) {
                    this.emit("player/wait", this);
                    return;
                }

                // Получаем ссылку на исходный трек
                track.resource.then((path) => {
                    // Если нет ссылки на аудио
                    if (!path) {
                        this.emit("player/error", this, `Not found link audio!`, "skip");
                        return;
                    }

                    // Если получена ошибка вместо ссылки
                    else if (path instanceof Error) {
                        this.emit("player/error", this, `Failed to getting link audio!\n\n${path.name}\n- ${path.message}`, "skip");
                        return;
                    }

                    this.emit("player/ended", this, seek);
                    this.read = {path, seek};
                }).catch((err) => {
                    this.emit("player/error", this, `${err}`, "skip");
                    Logger.log("ERROR", err);
                });
            };
        }
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean {
        return this.data.shuffle;
    };

    /**
     * @description Сохраняем данные перетасовки
     * @param bol - Параметр boolean
     * @public
     */
    public set shuffle(bol) {
        this.data.shuffle = bol;
    };

    /**
     * @description Сохраняем тип повтора
     * @param loop - Тип повтора
     * @public
     */
    public set repeat(loop: "off" | "song" | "songs") {
        this.data.repeat = loop;
    };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() {
        return this.data.repeat;
    };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() {
        return this.data.message;
    };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice(): VoiceChannel | StageChannel {
        return this.data.voice;
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
        return this.data.player;
    };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message: Client.message) {
        this.data.message = message;
    };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice {VoiceChannel} Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: VoiceChannel | StageChannel) {
        this.data.voice = voice;
        this.player.connection = Voice.join({
            selfDeaf: true,
            selfMute: false,

            guildId: this.guild.id,
            channelId: voice.id
        }, this.guild.voiceAdapterCreator);
    };

    public constructor(options: { voice: VoiceChannel | StageChannel; message: Client.message; }) {
        for (const [key, value] of Object.entries(options)) {
            try { this[key] = value; } catch (err) { throw TypeError(`Error in queue, ${key} is not found in the server queue`); }
        }
    };

    /**
     * @description Очищаем очередь
     * @public
     */
    public cleanup = () => {
        db.audio.cycles.players.remove(this.player);
        this.player.cleanup();

        for (let item of Object.keys(this.data)) this.data[item] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Список очередей для работы плеера
 * @namespace Queue
 */
export namespace Queue {
    /**
     * @author SNIPPIK
     * @description Класс очереди для проигрывания треков
     * @class Music
     */
    export class Music extends BaseQueue {
        private readonly _components = [
            { type: 2, emoji: {id: db.emojis.button.shuffle},   custom_id: 'shuffle',       style: 2 },  //Shuffle
            { type: 2, emoji: {id: db.emojis.button.pref},      custom_id: 'last',          style: 2 },  //Last song
            { type: 2, emoji: {id: db.emojis.button.pause},     custom_id: 'resume_pause',  style: 2 },  //Resume/Pause
            { type: 2, emoji: {id: db.emojis.button.next},      custom_id: 'skip',          style: 2 },  //Skip song
            { type: 2, emoji: {id: db.emojis.button.loop},      custom_id: 'repeat',        style: 2 }   //Loop
        ];
        /**
         * @author SNIPPIK
         * @description Создаем Array с треками для очереди
         */
        private readonly _songs = new class Songs extends Array<Song> {
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
        };

        /**
         * @description Получаем доступ к трекам
         * @public
         */
        public get songs() {
            return this._songs;
        };

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
    }
}
