import {AudioPlayer, AudioPlayerEvents, Filters} from "@lib/voice/player";
import {Attachment, StageChannel, VoiceChannel} from "discord.js";
import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {Queue} from "@lib/voice/player/queue/Queue";
import {Song} from "@lib/voice/player/queue/Song";
import {TypedEmitter} from "tiny-typed-emitter";
import {Constructor} from "@handler";
import {Client} from "@lib/discord";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с Global
 * @abstract
 */
export class Database_Audio {
    private readonly data = {
        queue: new AudioQueues(),
        cycles: new Cycles(),

        options: {
            volume: parseInt(env.get("audio.volume")),
            fade: parseInt(env.get("audio.fade")),
            timeout: parseInt(env.get("player.timeout")),

            audio: {
                timeout: parseInt(env.get("audio.timeout")),
            }
        },
        filters: Filters
    };
    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this.data.cycles; };

    /**
     * @description Выдаем данные для запуска AudioResource
     * @public
     */
    public get options() { return this.data.options; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this.data.queue; };

    /**
     * @description Получаем фильтры полученные из базы данных github
     * @return Filter[]
     * @public
     */
    public get filters() { return this.data.filters; };
}

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class Cycles
 * @private
 */
class Cycles {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление плеерами
     * @private
     */
    private readonly _audioPlayers = new class extends Constructor.Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayer",
                duration: parseInt(env.get("player.duration")),
                filter: (item) => item.playing,
                execute: (player: AudioPlayer) => {
                    if (player.connection?.state?.status !== "ready" || player?.status === "player/pause") return;
                    else if (player?.status !== "player/playing") player.sendPacket = Buffer.from([0xf8, 0xff, 0xfe]);
                    else {
                        const packet = player.stream.packet;

                        if (packet) player.sendPacket = packet;
                        else player.stop();
                    }
                }
            });
        };
    };
    public get players() { return this._audioPlayers; };

    /**
     * @author SNIPPIK
     * @description Здесь происходит управление сообщениями от плеера
     * @private
     */
    private readonly _messages = new class extends Constructor.Cycle<Client.message> {
        public constructor() {
            super({
                name: "Message",
                duration: parseInt(env.get("player.message")) * 1e3,
                filter: (message) => !!message.edit,
                execute: (message) => {
                    const {guild} = message;
                    const queue = db.audio.queue.get(guild.id);

                    if (!queue || !queue.songs.size) return this.remove(message);
                    else if (!queue.player.playing || !message.editable) return;

                    // Обновляем сообщение о текущем треке
                    db.audio.queue.events.emit("message/playing", queue, message);
                },
                custom: {
                    remove: (item) => {
                        MessageBuilder.delete = {message: item, time: 200}
                    },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        //Если это-же сообщение есть в базе, то нечего не делаем
                        if (old) this.remove(old);
                    }
                },
            });
        };
    };
    public get messages() { return this._messages; };
}

/**
 * @author SNIPPIK
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class AudioQueues
 * @private
 */
class AudioQueues extends Constructor.Collection<Queue> {
    private readonly _local = {
        emitter: new class extends TypedEmitter<CollectionAudioEvents & AudioPlayerEvents> {
            private _playerEvents: (keyof AudioPlayerEvents)[] = null;

            /**
             * @description Ивенты плеера
             * @return (keyof AudioPlayerEvents)[]
             */
            public get player() {
                if (this._playerEvents) return this._playerEvents;

                this._playerEvents = this.eventNames().filter((item: keyof AudioPlayerEvents) => item.match(/player\//)) as (keyof AudioPlayerEvents)[];
                return this._playerEvents;
            };
        },
    };

    /**
     * @description Получаем ивенты для плеера
     * @return CollectionAudioEvents
     * @public
     */
    public get events() { return this._local.emitter; };

    /**
     * @description Проверяем надо ли создать очередь и добавляем треки в нее
     * @param message - Сообщение пользователя
     * @param voice   - Голосовой канал
     * @param item    - Добавляемый объект
     */
    public create = (message: Client.message, voice: VoiceChannel | StageChannel, item: any) => {
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
}

/**
 * @author SNIPPIK
 * @description Ивенты коллекции
 * @interface CollectionAudioEvents
 */
export interface CollectionAudioEvents {
    // Сообщение о добавленном треке или плейлисте, альбоме
    "message/push": (queue: Queue | Client.message, items: Song | Song.playlist) => void;

    // Сообщение о текущем треке
    "message/playing": (queue: Queue, message?: Client.message) => void;

    // Сообщение об ошибке
    "message/error": (queue: Queue, error?: string | Error) => void;

    // Сообщение о поиске и выборе трека
    "message/search": (tracks: Song[], platform: string, message: Client.message) => void;

    // Сообщение о последнем треке
    "message/last": (track: Song, message: Client.message) => void;

    // Добавляем и создаем очередь
    "collection/api": (message: Client.message, voice: VoiceChannel | StageChannel, argument: (string | Attachment)[]) => void;

    // Если во время добавления трека или плейлиста произошла ошибка
    "collection/error": (message: Client.message, error: string, replied?: boolean, color?: "DarkRed" | "Yellow") => void;
}