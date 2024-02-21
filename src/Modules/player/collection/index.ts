import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {EmbedData, StageChannel, VoiceChannel} from "discord.js";
import onPlaying from "@handler/Events/Message/onPlaying";
import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Song} from "@watklok/player/queue/Song";
import {TypedEmitter} from "tiny-typed-emitter";
import {ActionMessage, Event} from "@handler";
import {httpsClient} from "@watklok/request";
import {TimeCycle} from "@watklok/timer";
import {Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description
 * @class Collection
 * @abstract
 */
export class Collection<T extends ArrayQueue> {
    private readonly _local = {
        emitter: new class extends TypedEmitter<CollectionEvents & AudioPlayerEvents> {
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
        cycles: new class {
            /**
             * @author SNIPPIK
             * @description Здесь происходит управление плеерами
             * @private
             */
            private readonly _audioPlayers = new class extends TimeCycle<AudioPlayer> {
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
            private readonly _messages = new class extends TimeCycle<ClientMessage> {
                public constructor() {
                    super({
                        name: "Message",
                        duration: parseInt(env.get("player.message")) * 1e3,
                        filter: (message) => !!message.edit,
                        execute: (message) => {
                            const {guild} = message;
                            const queue = db.queue.get(guild.id);

                            if (!queue || !queue.songs.size) return this.remove(message);
                            else if (!queue.player.playing || !queue.player.stream.duration || !message.editable) return;

                            setImmediate(() => {
                                const newEmbed = (new onPlaying() as Event<"message/playing">).execute(queue, true) as EmbedData;

                                //Обновляем сообщение
                                message.edit({
                                    embeds: [newEmbed as any],
                                    components: [queue.components as any]
                                }).catch((e) => {
                                    Logger.log("DEBUG", `[TimeCycle]: [editMessage]: ${e.message}`);
                                });
                            });
                        },
                        custom: {
                            remove: (item) => {
                                ActionMessage.delete = {message: item, time: 200}
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

            /**
             * @author SNIPPIK
             * @description Здесь происходит управление кешированием треков
             * @private
             */
            private readonly _downloader = env.get("cache") ? new class extends TimeCycle<Song> {
                public constructor() {
                    super({
                        name: "Downloader",
                        duration: 20e3,
                        filter: (item) => {
                            const names = this.status(item);

                            if (item.duration.seconds >= 800 && item.duration.full !== "Live" || names.status === "final") {
                                this.remove(item);
                                return false;
                            }

                            //Проверяем путь на наличие директорий
                            if (!existsSync(names.path)) {
                                let dirs = names.path.split("/");

                                if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                                mkdirSync(dirs.join("/"), {recursive: true});
                            }
                            return true;
                        },
                        execute: (track) => {
                            return new Promise<boolean>((resolve) => {
                                setImmediate(() => this.remove(track));

                                new httpsClient(track.link).request.then((req) => {
                                    if (req instanceof Error) return resolve(false);

                                    if (req.pipe) {
                                        const status = this.status(track);
                                        const file = createWriteStream(status.path);

                                        file.once("ready", () => req.pipe(file));
                                        file.once("error", console.warn);
                                        file.once("finish", () => {
                                            const refreshName = this.status(track).path.split(".raw")[0];
                                            rename(status.path, `${refreshName}.opus`, () => null);

                                            if (!req.destroyed) req.destroy();
                                            if (!file.destroyed) file.destroy();
                                            Logger.log("DEBUG", `[Cycle]: [Download]: in ${refreshName}.opus`);

                                            return resolve(true);
                                        });
                                    }

                                    return resolve(false);
                                });
                            });
                        }
                    });
                };
                /**
                 * @description Получаем статус скачивания и путь до файла
                 * @param track {Song}
                 */
                public readonly status = (track: Song): {status: "not" | "final" | "download", path: string} => {
                    try {
                        const dirname = __dirname.split("\\src")[0].replaceAll("\\", "/");
                        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
                        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
                        const fullPath = `${dirname}/${env.get("cached.dir")}/Audio/[${author}]/[${song}]`;


                        if (existsSync(`${fullPath}.opus`)) return {status: "final", path: `${fullPath}.opus`};
                        else if (existsSync(`${fullPath}.raw`)) return {status: "download", path: `${fullPath}.raw`};
                        return {status: "not", path: `${fullPath}.raw`};
                    } catch {
                        return { status: "not", path: null };
                    }
                };
            } : null;
            public get downloader() { return this._downloader; };
        },
        queues: [] as T[]
    };
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
    public set = (queue: T) => {
        this.cycles.players.push = queue.player;
        this._local.queues.push(queue);
        
        //Загружаем ивенты плеера
        for (const event of this.events.player) {
            queue.player.on(event as keyof AudioPlayerEvents, (...args: any[]) => {
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
    "player/error": (player: AudioPlayer, err: string, type?: "crash" | "skip") => void;
}