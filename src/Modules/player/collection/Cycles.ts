import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import onPlaying from "@handler/Events/Message/onPlaying";
import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ActionMessage, PlayerEvent} from "@handler";
import {Song} from "@watklok/player/queue/Song";
import {httpsClient} from "@Client/Request";
import {TimeCycle} from "@watklok/timer";
import {EmbedData} from "discord.js";
import {Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description
 * @class Cycles
 * @abstract
 */
export class Cycles {
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
                            const newEmbed: EmbedData = (new onPlaying() as PlayerEvent).execute(queue, true);

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