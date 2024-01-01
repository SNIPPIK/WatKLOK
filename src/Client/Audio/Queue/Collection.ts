import {ClientMessage} from "@handler/Events/Client/interactionCreate";
import {EmbedData, StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "@Client/Audio/Stream/AudioPlayer";
import {Song} from "@Client/Audio/Queue/Song";
import {ActionType} from "@handler";
import {ArrayQueue} from "./Queue";
import {APIs} from "@handler/APIs";
import {env, Logger} from "@env";

//AudioPlayer Messages
import toPushPlaylist from "@handler/Player/Messages/toPushPlaylist";
import toSearch from "@handler/Player/Messages/toSearch";
import toPlay from "@handler/Player/Messages/toPlay";
import toPush from "@handler/Player/Messages/toPush";
import {db} from "@Client/db";
import {ActionMessage} from "@Client";

/**
 * @author SNIPPIK
 * @description Локальная база с данными
 * @const _events
 */
const _events = ["onWait", "onStart", "onError"].map((file) => {
    const importFile = require(`../../../Handler/Player/Events/${file}.js`);
    const keysFile = Object.keys(importFile);

    if (keysFile.length <= 0) return null;

    return new importFile[keysFile[0]];
});



/**
 * @author SNIPPIK
 * @description Создаем модель очередей с их получением
 * @class ArrayCollection
 */
abstract class ArrayCollection {
    private readonly _queues: ArrayQueue[] = [];
    /**
     * @author SNIPPIK
     * @description Здесь хранятся все циклы
     * @class Cycles
     * @private
     */
    private readonly _cycles = new class Cycles {
        /**
         * @author SNIPPIK
         * @description Здесь происходит управление плеерами
         * @private
         */
        private readonly _audioPlayers = new class extends TimeCycle<AudioPlayer> {
            public constructor() {
                super({
                    duration: parseInt(env.get("player.duration")),
                    filter: (item) => item.playing,
                    execute: (player: AudioPlayer) => {
                        player.sendPacket = player.stream.packet;
                    },
                });
            };
        };
        public get players() { return this._audioPlayers; };

        /**
         * @author SNIPPIK
         * @description Здесь происходит управление сообщениями от плеера
         * @private
         */
        private readonly _messages = new class extends TimeCycle<ClientMessage> {
            public constructor() {
                super({
                    duration: parseInt(env.get("player.message")) * 1e3,
                    filter: (message) => !!message.edit,
                    execute: (message) => {
                        const {guild} = message;
                        const queue = db.music.queue.get(guild.id);

                        if (!queue || !queue.songs.size) return this.remove(message);
                        else if (!queue.player.hasUpdate || !queue.player.stream.duration || !message.editable) return;

                        setImmediate(() => {
                            const newEmbed: EmbedData = toPlay(queue, false);

                            //Обновляем сообщение
                            message.edit({embeds: [newEmbed as any], components: [queue.components as any]}).catch((e) => {
                                Logger.debug(`[CycleQueue]: [editMessage]: ${e.message}`);
                            });
                        });
                    },
                });
            };
        };
        public get messages() { return this._messages; };
    };

    /**
     * @description Получаем очередь из ID
     * @param ID {string} ID Сервера
     * @public
     */
    public get = (ID: string) => this._queues.find((queue) => queue.guild.id === ID);

    /**
     * @description Добавляем очередь в список
     * @param queue {ArrayQueue} Очередь
     * @public
     */
    public set = (queue: ArrayQueue) => {
        this.cycles.players.push(queue.player);
        this._queues.push(queue);

        setImmediate(() => {
            _events.forEach((classes) => {
                queue.player.on(classes.name, (...args: any[]) => classes.execute(queue, ...args));
            });
        });

        Logger.debug(`Queue: create for [${queue.guild.id}]`);
    };

    /**
     * @description Удаляем очередь из списка
     * @param ID {string} ID Сервера
     * @public
     */
    public remove = (ID: string) => {
        const queue = this.get(ID);
        const index = this._queues.indexOf(queue);

        if (index != -1) {
            if (queue.songs.size > 0) queue.songs.splice(0, queue.songs.size);
            queue.player.cleanup();

            this._queues.splice(index, 1);
        }

        Logger.debug(`Queue: deleted for [${ID}]`);
    };

    /**
     * @description Получаем кол-во очередь в списке
     * @public
     */
    public get size() { return this._queues?.length ?? 0; };

    /**
     * @description Выдаем класс Cycles
     * @return Cycles
     * @public
     */
    public get cycles() { return this._cycles; };
}



/**
 * @author SNIPPIK
 * @description База с музыкальными очередями
 * @class CollectionQueue
 */
export class Collection extends ArrayCollection {
    /**
     * @description Начинаем запуск и поиск в системе APIs
     * @param message {ClientMessage} Сообщение с сервера
     * @param VoiceChannel {VoiceChannel | StageChannel} Голосовой канал
     * @param argument {string} Запрос пользователя
     * @public
     */
    public readonly runAPIs = (message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, argument: string[]): ActionType.command | Promise<ActionType.command> => {
        const platform = new APIs(argument[0] ?? argument[1]);
        const platformLow = platform?.platform?.toLowerCase();

        //Если нет поддержки платформы
        if (!platform.platform) return { color: "Yellow",
            content: `⚠️ **Warning**\n\nУ меня нет поддержки этой платформы!`
        };

        //Если нельзя получить данные с определенной платформы
        else if (platform.block) return { color: "DarkRed",
            content: `⚠️ **Warning** | **${platformLow}**\n\nРазработчик заблокировал доступ к этой платформе!\nВозможно из-за ошибки или блокировки со стороны сервера!`
        };

        //Если нельзя получить данные с определенной платформы
        else if (platform.auth) return { color: "Yellow",
            content: `⚠️ **Warning** | **${platformLow}**\n\nНет данных для авторизации, запрос не может быть выполнен!`
        };

        const type = platform.type(argument[1]);
        const callback = platform.callback(type);

        //Если невозможно определить тип запросы
        if (!type) return { color: "Yellow",
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\nУ меня нет поддержки этого запроса!`
        }

        //Если нет поддержки запроса
        else if (!callback) return { color: "Yellow",
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\nУ меня нет поддержки для выполнения этого запроса!`
        };

        //Отправляем сообщение о том что был сделан запрос на сервер
        new ActionMessage({message, color: "Yellow", time: 5e3,
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\n${env.get("loading.emoji")} Ожидание ответа от сервера...\n${platform.audio ? "Эта платформа не может выдать исходный файл музыки!" : ""}`
        });

        return new Promise<ActionType.command>((resolve) => {
            callback(argument[1]).then((info) => {
                if (!info) return resolve({ color: "DarkRed",
                    content: `⚠️ **Warning** | **${platformLow}.${type}**\n\n**❯** Данные не были получены!`
                });
                else if (info instanceof Error) return resolve({ color: "DarkRed",
                    content: `⚠️ **Warning** | **${platformLow}.${type}**\n\n**❯** При получении данных была получена ошибка!`
                });

                //Если нет очереди, то создаём
                const queue = this.get(message.guild.id);
                if (!queue) this.set(new ArrayQueue(message, VoiceChannel));

                if (info instanceof Song) this.pushTrack = {queueID: message.guild.id, track: info, author: message.author};
                else if (info instanceof Array) toSearch(info, platform.platform, message);
                else this.pushTracks = { queueID: message.guild.id, info, author: message.author };
            }).catch((err) => { //Если возникнет ошибка
                Logger.error(`[${platformLow}.${type}]: ${err}`);

                //Отправляем сообщение об ошибке
                return resolve({ replied: true, color: "DarkRed",
                    content: `⛔️ **Error** | **${platformLow}.${type}**\n\n**❯** **${err.message}**`
                });
            });
        });
    }

    /**
     * @description Добавляем трек в очередь
     * @param options {queueID: string, info: ISong.track | Song.playlist} Параметры для добавления в очередь
     * @private
     */
    private set pushTrack(options: { queueID: string, track: Song, author: ClientMessage["author"] }) {
        const {queueID, track, author} = options;
        const queue = this.get(queueID);

        track.requesterSong = author;
        queue.songs.push(track);

        //Если это не первый трек, то отправляем сообщение о том что было добавлено
        if (queue.songs.size > 1) toPush(queue);
        else queue.player.play(queue.songs.song.resource, !queue.songs.song.options.isLive);
    };

    /**
     * @description Добавляем плейлист в очередь
     * @param options {queueID: string, info: ISong.track | Song.playlist} Параметры для добавления в очередь
     * @private
     */
    private set pushTracks(options: { queueID: string, info: Song.playlist, author: ClientMessage["author"] }) {
        const {queueID, info, author} = options;
        const queue = this.get(queueID);

        //Отправляем сообщение о том что плейлист будет добавлен в очередь
        toPushPlaylist(queue.message, info);

        if (queue.songs.size === 0) setImmediate(() => queue.player.play(queue.songs.song.resource, !queue.songs.song.options.isLive));

        //Загружаем треки из плейлиста в очередь
        for (let track of info.items) {
            track.requesterSong = author;
            queue.songs.push(track);
        }
    };
}



/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class ArrayCycle
 */
abstract class ArrayCycle<T = unknown> {
    protected readonly _array?: T[] = [];
    protected _time?: number = 0;
    protected _asyncStep?: () => void;
    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     * @public
     */
    public push? = (data: T) => {
        if ("guild" in (data as ClientMessage)) {
            const old: T = this._array.find(msg => (msg as ClientMessage).guild.id === (data as ClientMessage).guild.id);

            //Если это-же сообщение есть в базе, то нечего не делаем
            if (old) this.remove(old);
        } else if (this._array.includes(data)) this.remove(data);
        this._array.push(data);

        //Запускаем цикл
        if (this._array?.length === 1) {
            Logger.debug(`[AsyncCycle]: Start cycle`);

            this._time = Date.now();
            setImmediate(this._asyncStep);
        }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param data {any} Сам элемент
     * @public
     */
    public remove? = (data: T) => {
        if (this._array?.length === 0) return;

        const index = this._array.indexOf(data);
        if (index != -1) {
            if ("edit" in (data as ClientMessage)) {
                if ((data as ClientMessage) && (data as ClientMessage).deletable) (data as ClientMessage).delete().catch(() => undefined);
            }

            this._array.splice(index, 1);
        }
    };
}



/**
 * @author SNIPPIK
 * @description Задаем параметры для циклов и запускаем их
 * @class TimeCycle
 */
abstract class TimeCycle<T = unknown> extends ArrayCycle<T> {
    public readonly execute: (item: T) => void;
    public readonly filter: (item: T) => boolean;
    public readonly duration: number;
    protected constructor(options: {
        //Как выполнить функцию
        execute: (item: T) => void;

        //Фильтр объектов
        filter: (item: T) => boolean;

        //Через сколько времени выполнять функцию
        duration: number
    }) {
        super();
        Object.assign(this, options);
    };
    /**
     * @description Выполняем this._execute
     * @private
     */
    protected _asyncStep? = (): void => {
        //Если в базе больше нет объектов
        if (this._array?.length === 0) {
            Logger.debug(`[AsyncCycle]: Stop cycle`);
            this._time = 0;
            return;
        }

        //Высчитываем время для выполнения
        this._time += this.duration;

        for (let object of this._array.filter(this.filter)) {
            try {
                this.execute(object);
            } catch (err) {
                this._removeItem(err, object);
            }
        }

        //Выполняем функцию через ~this._time ms
        setTimeout(this._asyncStep, this._time - Date.now());
    };

    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param item {any} Объект который будет удален
     * @private
     */
    private _removeItem? = (err: string, item: T) => {
        Logger.warn(`[AsyncCycle]: Error in this._execute | ${err}`);
        this.remove(item);
    };
}