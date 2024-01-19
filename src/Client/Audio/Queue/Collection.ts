import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {ActionMessage, ICommand, RequestAPI, TimeCycle} from "@handler";
import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {EmbedData, StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "@Client/Audio/Player/AudioPlayer";
import {getPlayerMessage} from "@Client/Audio";
import {Song} from "@Client/Audio/Queue/Song";
import {httpsClient} from "@Client/Request";
import {ArrayQueue} from "./Queue";
import {Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description Локальная база с events
 * @const _events
 */
const _events = ["onWait", "onStart", "onError"].map((file) => {
    const importFile = require(`../../../Handlers/Events/Player/${file}.js`);
    const keysFile = Object.keys(importFile);

    if (keysFile.length === 0) return null;

    return new importFile[keysFile[0]];
});

/**
 * @author SNIPPIK
 * @description Создаем модель очередей с их получением
 * @class ArrayCollection
 */
export abstract class ArrayCollection {
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
                        if (player?.status !== "playing" && player.connection?.state?.status !== "ready") return;

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
                            const newEmbed: EmbedData = getPlayerMessage<"playing">("playing", [queue])["embeds"].pop();

                            //Обновляем сообщение
                            message.edit({embeds: [newEmbed as any], components: [queue.components as any]}).catch((e) => {
                                Logger.log("DEBUG", `[CycleQueue]: [editMessage]: ${e.message}`);
                            });
                        });
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
                    execute: async (track) => {
                        return new Promise<boolean>(async (resolve) => {
                            new httpsClient(track.link).request.then(async (req) => {
                                if (req instanceof Error) return resolve(false);

                                if (req.pipe) {
                                    const status = this.status(track);
                                    const file = createWriteStream(status.path);

                                    file.once("ready", async () => req.pipe(file));
                                    file.once("error", console.warn);
                                    file.once("finish", async () => {
                                        const refreshName = this.status(track).path.split(".raw")[0];
                                        rename(status.path, `${refreshName}.opus`, () => null);

                                        if (!req.destroyed) req.destroy();
                                        if (!file.destroyed) file.destroy();
                                        Logger.log("DEBUG", `[Cycle]: [Download]: in ${refreshName}.opus`);

                                        return resolve(true);
                                    });
                                }

                                this.remove(track);
                                return resolve(false);
                            });
                        });
                    }
                });
            }
            /**
             * @description Получаем статус скачивания и путь до файла
             * @param track {Song}
             */
            public readonly status = (track: Song): {status: "not" | "final" | "download", path: string} => {
                const dirname = __dirname.split("\\src")[0].replaceAll("\\", "/");
                const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
                const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
                const fullPath = `${dirname}/${env.get("cached.dir")}/Audio/[${author}]/[${song}]`;


                if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
                else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
                return { status: "not", path: `${fullPath}.raw` };
            };
        } : null;
        public get downloader() { return this._downloader; };
    };
    public get cycles() { return this._cycles; };

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

        for (let event of _events) queue.player.on(event.name, (...args: any[]) => event.execute(queue, ...args));

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
     * @description Получаем кол-во очередь в списке
     * @public
     */
    public get size() { return this._queues?.length ?? 0; };
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
    public readonly runAPIs = (message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, argument: string[]): ICommand.all | Promise<ICommand.all> => {
        const platform = new RequestAPI(argument[0] ?? argument[1]);
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

                if (info instanceof Song) this.pushTrack = {queueID: message.guild.id, track: info, author: message.author};
                else if (info instanceof Array) new ActionMessage(getPlayerMessage<"search">("search", [info, platform.platform, message]));
                else this.pushTracks = { queueID: message.guild.id, info, author: message.author };
            }).catch((err) => { //Если возникнет ошибка
                Logger.log("ERROR", `[${platformLow}.${type}]: ${err}`);

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
        if (queue.songs.size > 1) new ActionMessage(getPlayerMessage<"pushSong">("pushSong", [queue]));
        else queue.player.play(queue.songs.song.resource);
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
        new ActionMessage(getPlayerMessage<"pushPlaylist">("pushPlaylist", [queue.message, info]));

        if (queue.songs.size === 0) setImmediate(() => queue.player.play(queue.songs.song.resource));

        //Загружаем треки из плейлиста в очередь
        for (let track of info.items) {
            track.requesterSong = author;
            queue.songs.push(track);
        }
    };
}