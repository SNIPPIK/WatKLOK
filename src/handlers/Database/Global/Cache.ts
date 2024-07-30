import {createWriteStream, existsSync, mkdirSync, readFileSync, rename, writeFileSync} from "node:fs";
import {Song} from "@lib/voice/player/queue/Song";
import {httpsClient} from "@lib/request";
import {Constructor} from "@handler";
import {env, Logger} from "@env";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Путь до директории с кешированными данными
 */
const cache = `${env.get("cached.dir")}`;

/**
 * @author SNIPPIK
 * @description Сохраняем аудио файл трека
 */
class Audio extends Constructor.Cycle<Song> {
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
    public status = (track: Song): { status: "not" | "final" | "download", path: string } => {
        const title = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");

        try {
            const dir = `${path.resolve(`${cache}/Audio/[${author}]/[${title}]`)}`;
            const isOpus = existsSync(`${dir}.opus`), isRaw = existsSync(`${dir}.raw`);

            return {status: isOpus ? "final" : isRaw ? "download" : "not", path: dir + (isOpus ? `.opus` : `.raw`)}
        } catch {
            return {status: "not", path: null};
        }
    };
}

/**
 * @author SNIPPIK
 * @description История прослушиваний для серверов
 * @class History
 */
class History {
    private readonly data = {
        track: null     as Song,
        guildID: null   as string
    };
    /**
     * @description Получаем путь
     * @return string
     * @private
     */
    private get path() {
        return `${cache}/Guilds/[${this.data.guildID}].json`;
    };

    /**
     * @description Загружаем файл
     * @return null | string
     * @private
     */
    private get file() {
        if (!existsSync(this.path)) return null;

        return readFileSync(this.path, {encoding: "utf-8"});
    };

    /**
     * @description Сохраняем данные о треке в локальную базу
     * @param track {Song} Сохраняемый трек
     * @param GuildID {string} ID сервера
     */
    public constructor(track: Song, GuildID: string) {
        this.data.guildID = GuildID; this.data.track = track;

        //Если нет файла
        if (!existsSync(this.path)) this.saveToFile(this.path, { tracks: [] });

        setTimeout(() => {
            const file = JSON.parse(this.file);

            //Добавляем трек
            this.pushTrack(file.tracks);

            //Сортируем треки
            this.sortTracks(file.tracks);

            //Сохраняем файл
            this.saveToFile(this.path, file);
        }, 2e3);
    };


    /**
     * @description Добавляем трек в базу
     * @param tracks {Array<miniTrack>} Треки для сортировки
     * @return void
     * @private
     */
    private pushTrack = (tracks: Array<miniTrack>) => {
        const track = tracks.find((track) => track.url === this.data.track.url);

        if (track) {
            const index = tracks.indexOf(track);
            tracks[index].total++;
            return;
        }

        tracks.push({
            title: this.data.track.title,
            url: this.data.track.url,
            author: {
                title: this.data.track.author.title,
                url: this.data.track.author.url
            },

            platform: this.data.track.platform,
            total: 1
        });
    };
    /**
     * @description Сортируем треки по популярности
     * @param tracks {Array<miniTrack>} Треки для сортировки
     * @return void
     * @private
     */
    private sortTracks = (tracks: Array<miniTrack>) => {
        //Если треков более 1, то сортируем по популярности
        if (tracks.length > 1) (tracks as Array<miniTrack>).sort((track1, track2) => {
            return track2.total - track1.total;
        });
    };

    /**
     * @description Выдаем путь до файла
     * @param ID
     */
    public static getFile = (ID: string) => {
        const path = env.get("cached.dir") + `/Guilds/[${ID}].json`;

        if (!existsSync(path)) return null;

        return readFileSync(path, {encoding: "utf-8"});
    };

    /**
     * @description Сохраняем данные в файл
     * @param dir {string} Путь файла
     * @param data {any} Данные для записи
     */
    private saveToFile(dir: string, data: any): void {
        if (!existsSync(dir)) {
            let fixDir = dir.split("/");
            fixDir.splice(fixDir.length - 1, 1);

            mkdirSync(`${fixDir.join("/")}/`, {recursive: true});
        }

        setTimeout(() => {
            const file: object = JSON.parse(History.getFile(dir));
            writeFileSync(dir, JSON.stringify(data ? data : file, null, `\t`));
        }, 2e3);
    }
}

/**
 * @author SNIPPIK
 * @description Класс для управления другими классами
 */
export class Database_Cache {
    public audio = env.get("cache") ? new Audio() : null;
    public history = env.get("history") ? History : null;
}


/**
 * @author SNIPPIK
 * @description Данные кешируемые в json
 * @interface miniTrack
 */
interface miniTrack {
    title: string;
    url: string;
    author: {
        title: string;
        url: string;
    }

    platform: string;
    total: number;
}