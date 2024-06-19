import {AudioPlayer, AudioPlayerEvents, Filter} from "@lib/player/AudioPlayer";
import {Attachment, EmbedData, StageChannel, VoiceChannel} from "discord.js";
import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import onPlaying from "@handler/Events/Player/message";
import {API, Constructor, Handler} from "@handler";
import {TypedEmitter} from "tiny-typed-emitter";
import {Queue} from "@lib/player/queue/Queue";
import {Cache} from "@lib/player/utils/Cache";
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
            public subCommands = 0;

            /**
             * @description Ищем в array подходящий тип
             * @param names - Имя или имена для поиска
             * @public
             */
            public get = (names: string | string[]): T => {
                for (const cmd of this) {
                    if (names instanceof Array) {
                        for (const name of names) {
                            if (cmd.data.name === name || cmd.data.name === name) return cmd;
                        }
                    } else if (cmd.data.name === names) return cmd;
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
            return new Promise<true>((resolve) => {
                const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);

                // Загрузка глобальных команд
                client.application.commands.set(this.commands.map((command) => command.data) as any)
                    .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.commands.public.length}] has load public commands`))
                    .catch(console.error);

                // Загрузка приватных команд
                if (guild) guild.commands.set(this.commands.owner.map((command) => command.data) as any)
                    .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.commands.owner.length}] has load private commands`))
                    .catch(console.error);

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
        private readonly data = {
            options: {volume: parseInt(env.get("audio.volume")), fade: parseInt(env.get("audio.fade"))},
            filters: [] as Filter[],
            queue: new class extends Constructor.Collection<Queue.Music> {
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
            },
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

                /**
                 * @author SNIPPIK
                 * @description Здесь происходит управление кешированием треков
                 * @private
                 */
                private readonly _downloader = env.get("cache") ? new Cache.Audio() : null;
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
        public get queue() { return this.data.queue; };

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
        /**
         * @description База с платформами
         * @protected
         * @readonly
         */
        protected readonly _platforms = {
            /**
             * @description Поддерживаемые платформы
             */
            supported: [] as API.request[],

            /**
             * @description Платформы с отсутствующими данными для авторизации
             */
            authorization: [] as API.platform[],

            /**
             * @description Платформы с возможностью получить аудио
             * По-умолчанию запрос идет к track
             */
            audio: [] as API.platform[],

            /**
             * @description Заблокированные платформы, только через owner.list
             */
            block: [] as API.platform[]
        };
        /**
         * @description База с лимитами обрабатываемых данных
         * @protected
         * @readonly
         */
        protected readonly _limits = {
            playlist: parseInt(env.get("APIs.limit.playlist")),
            album: parseInt(env.get("APIs.limit.album")),

            search: parseInt(env.get("APIs.limit.search")),
            author: parseInt(env.get("APIs.limit.author"))
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
        emojis: {
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
        },
    };
    /**
     * @description База для управления музыкой
     * @public
     */
    public get audio() { return this.data.audio };

    /**
     * @description База для управления APIs
     * @public
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
    public get emojis() { return this.data.emojis; };

    /**
     * @description Запускаем index
     * @param client {Client} Класс клиента
     * @public
     */
    public set initialize(client: Client) {
        const dirs = ["handlers/APIs", "handlers/Commands", "handlers/Events", "handlers/Plugins"];
        const callbacks = [
            (item: API.request) => {
                //Если нет данных, то откидываем платформу
                if (!item.auth) this.api.platforms.authorization.push(item.name);

                //Поддерживает ли платформа получение аудио
                if (!item.audio) this.api.platforms.audio.push(item.name);

                this.api.platforms.supported.push(item);
            },
            (item: Handler.Command) => {
                if (item.data.options) {
                    for (const option of item.data.options) {
                        if ("options" in option) this._commands.subCommands += option.options.length;
                    }

                    this._commands.subCommands += item.data.options.length;
                }

                this.commands.push(item)
            },
            (item: Handler.Event<any>) => {
                if (item.type === "client") client.on(item.name as any, (...args: any[]) => item.execute(client, ...args)); // @ts-ignore
                else this.audio.queue.events.on(item.name as any, (...args: any[]) => item.execute(...args));
            },
            (item: Handler.Plugin) => {
                try {
                    item.start({client});
                } catch (err) {
                    throw new Error(`[Plugin]: ${err}`);
                }
            }
        ];

        Logger.log("LOG", `[Shard ${client.ID}] is initialized database`);

        (async () => {
            //Проверяем статус получения фильтров
            const filterStatus = await this.audio.loadFilters;
            if (filterStatus instanceof Error) Logger.log("ERROR", `[Shard ${client.ID}] is initialized filters`);
            else Logger.log("LOG", `[Shard ${client.ID}] is initialized filters`);

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

            //Отправляем данные о командах на сервера discord
            if (client.ID === 0) await this.registerCommands(client);
        })();
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