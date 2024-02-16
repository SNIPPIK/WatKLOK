import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Cycles} from "@watklok/player/collection/Cycles";
import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {EmbedData, StageChannel, VoiceChannel} from "discord.js";
import {Song} from "@watklok/player/queue/Song";
import {TypedEmitter} from "tiny-typed-emitter";
import {Logger} from "@Client";

/**
 * @author SNIPPIK
 * @description
 * @class CollectionArray
 * @abstract
 */
export class Collection {
    private readonly _local = {
        emitter: new class extends TypedEmitter<CollectionEvents & AudioPlayerEvents> {},
        queues: [] as ArrayQueue[],
        cycles: new Cycles()
    }
    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this._local.cycles; };

    /**
     * @description Получаем ивенты для плеера
     * @return CollectionEvents
     * @public
     */
    public get events() { return this._local.emitter; };

    /**
     * @description Получаем кол-во очередей в списке
     * @public
     */
    public get size() { return this._local.queues?.length ?? 0; };

    /**
     * @description Получаем очередь из ID
     * @param ID {string} ID Сервера
     * @public
     */
    public get = (ID: string) => {
        return this._local.queues.find((queue) => queue.guild.id === ID);
    };

    /**
     * @description Добавляем очередь в список
     * @param queue {ArrayQueue} Очередь
     * @public
     */
    public set = (queue: ArrayQueue) => {
        this.cycles.players.push = queue.player;
        this._local.queues.push(queue);
        
        //Загружаем ивенты плеера
        const events = ["player/playing", "player/wait", "player/error", "player/ended"] as AudioPlayerStatus[];
        for (let num = 0; num < events.length; num++) {
            const event = events[num];
            
            queue.player.on(event, (...args: any[]) => {
                this.events.emit<any>(event, queue, ...args);
            });
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
        const index = this._local.queues.indexOf(queue);

        if (index != -1) {
            queue.cleanup();
            this._local.queues.splice(index, 1);
        }

        Logger.log("DEBUG", `Queue: deleted for [${ID}]`);
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты коллекции
 * @interface AudioPlayerEvents
 */
export interface CollectionEvents {
    //Сообщение о добавленном треке или плейлисте, альбоме
    "message/push"   : (queue: ArrayQueue | ClientMessage, items: Song | Song.playlist) => void;

    //Сообщение о текущем треке
    "message/playing": (queue: ArrayQueue, isReturn?: boolean) => void | EmbedData;

    //Сообщение об ошибке
    "message/error"  : (queue: ArrayQueue, error?: string | Error) => void;

    //Сообщение о поиске и выборе трека
    "message/search" : (tracks: Song[], platform: string, message: ClientMessage) => void;

    //Добавляем и создаем очередь
    "collection/api": (message: ClientMessage, voice: VoiceChannel | StageChannel, argument: string[]) => void;

    //Если во время добавления трека или плейлиста произошла ошибка
    "collection/error": (message: ClientMessage, error: string, color?: "DarkRed" | "Yellow") => void;
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