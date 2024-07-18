import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {Song} from "@lib/voice/player/queue/Song";
import {httpsClient} from "@lib/request";
import {Constructor} from "@handler";
import * as path from "node:path";
import {env, Logger} from "@env";

const cache = `${env.get("cached.dir")}`;

/**
 * @author SNIPPIK
 * @description Пространство для кеширования данных
 * @namespace Cache
 */
export namespace Cache {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление кешированием треков
     */
    export class AudioFile extends Constructor.Cycle<Song> {
        public constructor() {
            super({
                name: "AudioFile",
                duration: 20e3,
                filter: (item) => {
                    const names = this.status(item);

                    //Если уже скачено или не подходит для скачивания то, пропускаем
                    if (names.status === "final" || item.duration.seconds === 0 && item.duration.seconds >= 800) {
                        this.remove(item);
                        return false;

                    //Если нет директории автора то, создаем ее    
                    } else if (!existsSync(names.path)) {
                        let dirs = names.path.split("/");

                        if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                        mkdirSync(dirs.join("/"), {recursive: true});
                    }
                    return true;
                },
                execute: (track) => new Promise<boolean>((resolve) => {
                    setImmediate(() => this.remove(track));

                    new httpsClient(track.link).request.then((req) => {
                        if (req instanceof Error) return resolve(false);
                        else if ("pipe" in req) {
                            const status = this.status(track);
                            const file = createWriteStream(status.path);

                            file.once("ready", () => req.pipe(file as any));
                            file.once("error", console.warn);
                            file.once("finish", () => {
                                const refreshName = this.status(track).path.split(".raw")[0];
                                rename(status.path, `${refreshName}.opus`, () => null);

                                if (!req.destroyed) req.destroy();
                                if (!file.destroyed) {
                                    file.destroy();
                                    file.end();
                                }
                                Logger.log("DEBUG", `[Download] in ${refreshName}`);

                                return resolve(true);
                            });
                        }

                        return resolve(false);
                    });
                })
            });
        };

        /**
         * @description Получаем статус скачивания и путь до файла
         * @param track {Song}
         */
        public status = (track: Song): {status: "not" | "final" | "download", path: string} => {
            const title = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
            const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");

            try {
                const dir = `${path.resolve(`${cache}/Audio/[${author}]/[${title}]`)}`;
                const isOpus = existsSync(`${dir}.opus`), isRaw = existsSync(`${dir}.raw`);

                return { status: isOpus ? "final" : isRaw ? "download" : "not", path: dir + (isOpus ? `.opus` : `.raw`) }
            } catch {
                return { status: "not", path: null };
            }
        };
    }
}