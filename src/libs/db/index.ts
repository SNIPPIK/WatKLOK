import {Attachment, EmbedData, Routes, StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer, AudioPlayerEvents, Filter} from "@lib/player/AudioPlayer";
import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import onPlaying from "@handler/Events/Player/message";
import {API, Constructor, Handler} from "@handler";
import {TypedEmitter} from "tiny-typed-emitter";
import {Queue} from "@lib/player/queue/Queue";
import {Song} from "@lib/player/queue/Song";
import {httpsClient} from "@lib/request";
import {Client} from "@lib/discord";
import {env, Logger} from "@env";

const git = `${env.get("git")}/${env.get("branch")}/`;

/**
 * @author SNIPPIK
 * @description Список поддерживаемых баз данных
 * @namespace SupportDataBase
 */
namespace SupportDataBase {
    /**
     * @author SNIPPIK
     * @description Коллекция команд
     * @abstract
     */
    export class Commands {
        protected readonly _commands = new class<T extends Handler.Command> extends Array<T> {
            /**
             * @description Ищем в array подходящий тип
             * @param names - Имя или имена для поиска
             */
            public get = (names: string | string[]): T => {
                for (const cmd of this) {
                    if (names instanceof Array) {
                        for (const name of names) {
                            if (cmd.name === name || cmd.name === name) return cmd;
                        }
                    } else if (cmd.name === names) return cmd;
                }

                return null;
            };

            /**
             * @description Команды для разработчика
             * @return Command[]
             * @public
             */
            public get owner() { return this.filter((command) => command.owner); };

            /**
             * @description Команды доступные для всех
             * @return Command[]
             * @public
             */
            public get public() { return this.filter((command) => !command.owner); };
        };
        /**
         * @description Выдаем класс с командами
         * @public
         */
        public get commands() { return this._commands; };

        /**
         * @description Загружаем команды для бота в Discord
         * @param client {Client} Класс клиента
         * @return Promise<true>
         * @public
         */
        public registerCommands = (client: Client): Promise<boolean> => {
            return new Promise<true>(async (resolve) => {
                //Загружаем все команды
                const PublicData: any = await client.rest.put(Routes.applicationCommands(client.user.id), {body: this.commands.public});
                const OwnerData: any = await client.rest.put(Routes["applicationGuildCommands"](client.user.id, env.get("owner.server")), {body: this.commands.owner});

                Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands] ${PublicData.length}/${OwnerData.length}`);
                return resolve(true);
            });
        };
    }

    /**
     * @author SNIPPIK
     * @description Коллекция для взаимодействия с Audio
     * @abstract
     */
    export class Audio {
        private readonly audioCollection = new class extends Constructor.Collection<Queue.Music> {
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
             * @description Добавляем очередь в список
             * @param queue - Очередь сервера
             *
             * @remarks
             * Добавлять при создании очереди! В function set
             * @public
             */
            public runQueue = (queue: Queue.Music) => {
                db.audio.cycles.players.set(queue.player);

                //Загружаем ивенты плеера
                for (const event of this.events.player) {
                    queue.player.on(event as keyof AudioPlayerEvents, (...args: any[]) => {
                        this.events.emit(event as any, queue, ...args);
                    });
                }
            };

            /**
             * @description Получаем ивенты для плеера
             * @return CollectionAudioEvents
             * @public
             */
            public get events() { return this._local.emitter; };
        }
        private readonly data = {
            options: { volume:  parseInt(env.get("audio.volume")), fade: parseInt(env.get("audio.fade")) },
            filters: [] as  Filter[],
            cycles: new class {
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
                                else if (!queue.player.playing || !queue.player.stream.duration || !message.editable) return;

                                setImmediate(() => {
                                    const newEmbed = (new onPlaying[0]() as Handler.Event<"message/playing">).execute(queue, true) as EmbedData;

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
                                    Constructor.message.delete = {message: item, time: 200}
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
                private readonly _downloader = env.get("cache") ? new class extends Constructor.Cycle<Song> {
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
                    public status = (track: Song): {status: "not" | "final" | "download", path: string} => {
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
            }
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
        public get queue() { return this.audioCollection; };

        /**
         * @description Получаем фильтры полученные из базы данных github
         * @return Filter[]
         * @public
         */
        public get filters() { return this.data.filters; };

        /**
         * @description Получаем фильтры из базы данных WatKLOK
         * @return Promise<Error | true>
         * @public
         */
        public get loadFilters(): Promise<Error | true> {
            return new Promise<Error | true>(async (resolve, reject) => {
                const raw = await new httpsClient(git + env.get("filters.url"), {useragent: true}).toJson;

                if (raw instanceof Error) return reject(Error("[Git]: Fail to getting data a github from filters.json"));
                this.filters.push(...raw as any[]);

                return resolve(true);
            });
        };
    }

    /**
     * @author SNIPPIK
     * @description Коллекция для взаимодействия с APIs
     * @abstract
     */
    export class APIs {
        protected readonly _platforms = {
            supported: [] as API.request[],
            authorization: [] as API.platform[],
            audio: [] as API.platform[],
            block: [] as API.platform[]
        };
        protected readonly _limits = {
            search: parseInt(env.get("APIs.limit.search")),
            author: parseInt(env.get("APIs.limit.author")),
            playlist: parseInt(env.get("APIs.limit.playlist")),
        };

        /**
         * @description Получаем лимиты по запросам
         * @return object
         * @public
         */
        public get limits() { return this._limits; };

        /**
         * @description Получаем все данные об платформе
         * @return object
         * @public
         */
        public get platforms() { return this._platforms; };

        /**
         * @description Исключаем некоторые платформы из доступа
         * @public
         */
        public get allow() {
            return this._platforms.supported.filter((platform) => platform.name !== "DISCORD");
        };
    }
}

/**
 * @author SNIPPIK
 * @class DataBase
 * @description База данных бота
 * @public
 */
export const db = new class DataBase extends SupportDataBase.Commands {
    private readonly data = {
        audio: new SupportDataBase.Audio(),
        apis: new SupportDataBase.APIs(),

        owners: env.get("owner.list").match(/,/) ? env.get("owner.list").split(",") : [env.get("owner.list")] as string[],
    };
    protected readonly _emojis = {
        button: {
            resume: env.get("button.resume"),
            pause: env.get("button.pause"),
            loop: env.get("button.loop"),
            loop_one: env.get("button.loop_one"),
            pref: env.get("button.pref"),
            next: env.get("button.next"),
            shuffle: env.get("button.shuffle")
        },

        progress: {
            empty: {
                left: env.get("progress.empty.left"),
                center: env.get("progress.empty.center"),
                right: env.get("progress.empty.right")
            },
            upped: {
                left: env.get("progress.not_empty.left"),
                center: env.get("progress.not_empty.center"),
                right: env.get("progress.not_empty.right")
            },
            bottom: env.get("progress.bottom")
        },
        noImage: git + env.get("image.not"),
        diskImage: git + env.get("image.currentPlay")
    };
    /**
     * @description База для управления музыкой
     * @public
     */
    public get audio() { return this.data.audio };

    /**
     * @description База для управления APIs
     */
    public get api() { return this.data.apis };

    /**
     * @description ID пользователей которые являются разработчиками
     * @public
     */
    public get owners() { return this.data.owners; };

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public get emojis() { return this._emojis; };

    /**
     * @description Загружаем Imports
     * @param client {Client} Класс клиента
     * @return Promise<true>
     * @public
     */
    private initFs = async (client: Client): Promise<void> => {
        const dirs = ["handlers/APIs", "handlers/Commands", "handlers/Events"];
        const callbacks = [
            (item: API.request) => {
                //Если нет данных, то откидываем платформу
                if (!item.auth) this.api.platforms.authorization.push(item.name);

                //Поддерживает ли платформа получение аудио
                if (!item.audio) this.api.platforms.audio.push(item.name);

                this.api.platforms.supported.push(item);
            },
            (item: Handler.Command) => this.commands.push(item),
            (item: Handler.Event<any>) => {
                if (item.type === "client") client.on(item.name as any, (...args: any[]) => item.execute(client, ...args)); // @ts-ignore
                else this.audio.queue.events.on(item.name as any, (...args: any[]) => item.execute(...args));
            }
        ];

        //Постепенно загружаем директории с данными
        for (let n = 0; n < dirs.length; n++) {
            const path = dirs[n];

            try {
                new Handler<any>({ path, callback: callbacks[n] });
                Logger.log("LOG", `[Shard ${client.ID}] have been uploaded, ${path}`);
            } catch (err) {
                Logger.log("ERROR", err);
            }
        }
    };

    /**
     * @description Запускаем index
     * @param client {Client} Класс клиента
     * @return Promise<true>
     * @public
     */
    public initHandler = async (client: Client): Promise<void> => {
        Logger.log("LOG", `[Shard ${client.ID}] is initialized database`);

        //Проверяем статус получения фильтров
        const filterStatus = await this.audio.loadFilters;
        if (filterStatus instanceof Error) Logger.log("ERROR", `[Shard ${client.ID}] is initialized filters`);
        else Logger.log("LOG", `[Shard ${client.ID}] is initialized filters`);

        //Загружаем под папки в handlers
        await this.initFs(client); await this.registerCommands(client);
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты коллекции
 * @interface CollectionAudioEvents
 */
export interface CollectionAudioEvents {
    //Сообщение о добавленном треке или плейлисте, альбоме
    "message/push": (queue: Queue.Music | Client.message, items: Song | Song.playlist) => void;

    //Сообщение о текущем треке
    "message/playing": (queue: Queue.Music, isReturn?: boolean) => void | EmbedData;

    //Сообщение об ошибке
    "message/error": (queue: Queue.Music, error?: string | Error) => void;

    //Сообщение о поиске и выборе трека
    "message/search": (tracks: Song[], platform: string, message: Client.message) => void;

    //Добавляем и создаем очередь
    "collection/api": (message: Client.message, voice: VoiceChannel | StageChannel, argument: (string | Attachment)[]) => void;

    //Если во время добавления трека или плейлиста произошла ошибка
    "collection/error": (message: Client.message, error: string, replied?: boolean, color?: "DarkRed" | "Yellow") => void;
}