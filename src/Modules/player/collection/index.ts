import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Collection_Cycles} from "@watklok/player/collection/Cycles";
import {ActionMessage, ICommand, ResponseAPI} from "@handler";
import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {StageChannel, VoiceChannel} from "discord.js";
import {Song} from "@watklok/player/queue/Song";
import {TypedEmitter} from "tiny-typed-emitter";
import {Logger} from "@Client";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description
 * @class CollectionArray
 * @abstract
 */
export class Collection {
    private readonly _cycles = new Collection_Cycles();
    private readonly _queues: ArrayQueue[] = [];
    /**
     * @author SNIPPIK
     * @description Ивенты для плеера и вызова сообщений
     * @class CollectionEv
     */
    private readonly _emitter = new class extends TypedEmitter<CollectionEvents & AudioPlayerEvents> {};

    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this._cycles; };

    /**
     * @description Получаем ивенты для плеера
     * @return CollectionEvents
     * @public
     */
    public get events() { return this._emitter; };

    /**
     * @description Получаем кол-во очередей в списке
     * @public
     */
    public get size() { return this._queues?.length ?? 0; };

    /**
     * @description Получаем очередь из ID
     * @param ID {string} ID Сервера
     * @public
     */
    public get = (ID: string) => {
        return this._queues.find((queue) => queue.guild.id === ID);
    };

    /**
     * @description Добавляем очередь в список
     * @param queue {ArrayQueue} Очередь
     * @public
     */
    public set = (queue: ArrayQueue) => {
        const events = this.events.eventNames().filter((ev) => ev.match(/player/)) as AudioPlayerStatus[];

        this.cycles.players.push(queue.player);
        this._queues.push(queue);

        //Загружаем ивенты плеера
        for (const item of events) { //@ts-ignore
            queue.player.on(item, (...args: any[]) => this.events.emit(item, queue, ...args));
        }
        Logger.log("DEBUG", `Queue: create for [${queue.guild.id}]`);
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

        Logger.log("DEBUG", `Queue: deleted for [${ID}]`);
    };

    /**
     * @description Добавляем треки в очередь
     * @param options {queueID: string, info: ISong.track | Song.playlist} Параметры для добавления в очередь
     * @private
     */
    public set pushTracks({queueID, array, author}: {queueID: string, array: Song[], author: ClientMessage["author"]}) {
        const queue = this.get(queueID);

        //Пишем о добавлении трека
        if (queue.songs.size >= 1) {
            if (array.length === 1) setImmediate(() => this.events.emit("message/push", queue, array));
        } else if (!queue.player.playing) setImmediate(() => queue.player.play(queue.songs.song));

        //Добавляем треки в очередь
        for (let n = 0; array.length > n; n++) {
            const track = array[n];
            track.requesterSong = author;
            queue.songs.push(track);
        }
    };

    /**
     * @description Начинаем запуск и поиск в системе APIs с созданием очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param VoiceChannel {VoiceChannel | StageChannel} Голосовой канал
     * @param argument {string} Запрос пользователя
     * @public
     */
    public runAPIs = (message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, argument: string[]): ICommand.all | Promise<ICommand.all> => {
        const platform = new ResponseAPI(argument[0] ?? argument[1]), platformLow = platform.platform.toLowerCase();
        const platformError = platform.block ? 1 : platform.auth ? 2 : !argument[1].match(platform.filter) && argument[1].startsWith("http") ? 3 : undefined;

        //Если есть ошибка при попытке использовать платформу
        if (platformError) {
            let error: string;

            if (platformError === 1) error = "Разработчик заблокировал доступ к этой платформе!\\nВозможно из-за ошибки или блокировки со стороны сервера!";
            else if (platformError === 2) error = "Нет данных для авторизации, запрос не может быть выполнен!";
            else error = "Этот запрос не относится к этой платформе!";

            return { color: "DarkRed", content: `⚠️ **Warning** | **${platformLow}**\n\n${error}` };
        }
        const type = platform.type(argument[1]);

        //Если невозможно определить тип запросы
        if (!type) return { color: "Yellow",
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\nУ меня нет поддержки этого запроса!`
        }
        const callback = platform.callback(type);

        //Если нет поддержки запроса
        if (!callback) return { color: "Yellow",
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\nУ меня нет поддержки для выполнения этого запроса!`
        };

        //Отправляем сообщение о том что был сделан запрос на сервер
        new ActionMessage({message, color: "Yellow", time: 5e3,
            content: `⚠️ **Warning** | **${platformLow}.${type}**\n\n${env.get("loading.emoji")} Ожидание ответа от сервера...\n${platform.audio ? "Эта платформа не может выдать исходный файл музыки! Поиск трека!" : ""}`
        });

        return new Promise<ICommand.all>((resolve) => {
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

                if (info instanceof Song) this.pushTracks = {queueID: message.guild.id, array: [info], author: message.author};
                else if (info instanceof Array) this.events.emit("message/search", info, platform.platform, message);
                else {
                    //Отправляем сообщение о том что плейлист будет добавлен в очередь
                    this.events.emit("message/push", message, info)
                    this.pushTracks = { queueID: message.guild.id, array: info.items, author: message.author };
                }
            }).catch((err) => { //Если возникнет ошибка
                Logger.log("ERROR", `[${platformLow}.${type}]: ${err}`);

                //Отправляем сообщение об ошибке
                return resolve({ replied: true, color: "DarkRed",
                    content: `⛔️ **Error** | **${platformLow}.${type}**\n\n**❯** **${err.message}**`
                });
            });
        });
    }
}

/**
 * @author SNIPPIK
 * @description Ивенты коллекции
 * @interface AudioPlayerEvents
 */
export interface CollectionEvents {
    //Сообщение о добавленном треке или плейлисте, альбоме
    "message/push"   : (queue: ArrayQueue | ClientMessage, items: Song[] | Song.playlist) => void;

    //Сообщение о текущем треке
    "message/playing": (queue: ArrayQueue, seek?: number) => void;

    //Сообщение об ошибке
    "message/error"  : (queue: ArrayQueue, error?: string | Error) => void;

    //Сообщение о поиске и выборе трека
    "message/search" : (tracks: Song[], platform: string, message: ClientMessage) => void;
}

/**
 * @author SNIPPIK
 * @description Статусы плеера
 * @type AudioPlayerStatus
 */
export type AudioPlayerStatus = "player/wait" | "player/pause" | "player/playing" | "player/error";

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    //Плеер начал играть новый трек
    "player/ended": (player: AudioPlayer, seek: number) => void;

    //Плеер закончил играть трек
    "player/wait": (player: AudioPlayer) => void;

    //Плеер встал на паузу
    "player/pause": (player: AudioPlayer) => void;

    //Плеер играет
    "player/playing": (player: AudioPlayer) => void;

    //Плеер получил ошибку
    "player/error": (player: AudioPlayer, err: string, critical?: boolean) => void;
}