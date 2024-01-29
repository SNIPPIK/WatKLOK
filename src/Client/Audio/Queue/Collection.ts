import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {ActionMessage, ICommand, ResponseAPI, TimeCycle} from "@handler";
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
 * @description
 * @class CollectionCycles
 * @abstract
 */
class CollectionCycles {
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
                    if (player.connection?.state?.status !== "ready" || player?.status === "pause") return;
                    else if (player?.status !== "playing") player.sendPacket = Buffer.from([0xf8, 0xff, 0xfe]);
                    else player.sendPacket = player.stream.packet;
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
                    const queue = db.queue.get(guild.id);

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
}

/**
 * @author SNIPPIK
 * @description
 * @class CollectionArray
 * @abstract
 */
abstract class CollectionArray {
    private readonly _local = {
        array: [] as ArrayQueue[],
        cycles: new CollectionCycles()
    };
    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this._local.cycles; };

    /**
     * @description Получаем очередь из ID
     * @param ID {string} ID Сервера
     * @public
     */
    public get = (ID: string) => this._local.array.find((queue) => queue.guild.id === ID);

    /**
     * @description Добавляем очередь в список
     * @param queue {ArrayQueue} Очередь
     * @public
     */
    public set = (queue: ArrayQueue) => {
        this.cycles.players.push(queue.player);
        this._local.array.push(queue);

        //Загружаем ивенты плеера
        for (const item of db.events.player) queue.player.on(item.name as any, (...args: any[]) => item.execute(queue as any, ...args));
        Logger.log("DEBUG", `Queue: create for [${queue.guild.id}]`);
    };

    /**
     * @description Удаляем очередь из списка
     * @param ID {string} ID Сервера
     * @public
     */
    public remove = (ID: string) => {
        const queue = this.get(ID);
        const index = this._local.array.indexOf(queue);

        if (index != -1) {
            if (queue.songs.size > 0) queue.songs.splice(0, queue.songs.size);
            queue.player.cleanup();

            this._local.array.splice(index, 1);
        }

        Logger.log("DEBUG", `Queue: deleted for [${ID}]`);
    };

    /**
     * @description Получаем кол-во очередей в списке
     * @public
     */
    public get size() { return this._local.array?.length ?? 0; };
}

/**
 * @author SNIPPIK
 * @description База с музыкальными очередями
 * @class CollectionQueue
 */
export class Collection extends CollectionArray {
    /**
     * @description Начинаем запуск и поиск в системе APIs
     * @param message {ClientMessage} Сообщение с сервера
     * @param VoiceChannel {VoiceChannel | StageChannel} Голосовой канал
     * @param argument {string} Запрос пользователя
     * @public
     */
    public readonly runAPIs = (message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, argument: string[]): ICommand.all | Promise<ICommand.all> => {
        const platform = new ResponseAPI(argument[0] ?? argument[1]), platformLow = platform.platform.toLowerCase();
        const platformError = platform.block ? 1 : platform.auth ? 2 : !argument[1].match(platform.filter) ? 3 : undefined;

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
        if (!callback || !argument[1].match(platform.filter)) return { color: "Yellow",
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

                if (info instanceof Song) this.pushTracks = {queueID: message.guild.id, array: [info], author: message.author};
                else if (info instanceof Array) new ActionMessage(getPlayerMessage<"search">("search", [info, platform.platform, message]));
                else {
                    //Отправляем сообщение о том что плейлист будет добавлен в очередь
                    new ActionMessage(getPlayerMessage<"pushPlaylist">("pushPlaylist", [message, info]));
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

    /**
     * @description Добавляем треки в очередь
     * @param options {queueID: string, info: ISong.track | Song.playlist} Параметры для добавления в очередь
     * @private
     */
    private set pushTracks({queueID, array, author}: {queueID: string, array: Song[], author: ClientMessage["author"]}) {
        const queue = this.get(queueID);

        //Пишем о добавлении трека
        if (queue.songs.size >= 1) {
           if (array.length === 1) setImmediate(() => new ActionMessage(getPlayerMessage<"pushSong">("pushSong", [queue])));
        } else if (!queue.player.playing) setImmediate(() => queue.player.play(queue.songs.song));

        //Добавляем треки в очередь
        for (let n = 0; array.length > n; n++) {
            const track = array[n];
            track.requesterSong = author;
            queue.songs.push(track);
        }
    };
}