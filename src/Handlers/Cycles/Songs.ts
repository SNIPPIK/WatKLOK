import {LifeCycle} from "../../Models/Abstracts/LifeCycle";
import {Song} from "@AudioPlayer/Queue/Song";
import {createWriteStream, existsSync, mkdirSync, rename} from "fs";
import {Logger} from "@Logger";
import {httpsClient} from "@Request";
import {env} from "@env";

const debug = env.get("debug.player.cache");
/**
 *
 * @description Жизненный цикл всех треков для скачивания
 *
 */
export class DownloadManager extends LifeCycle<Song> {
    protected readonly duration = 2e3;
    protected readonly type = "single";


    /**
     * @description Добавляем трек в локальную базу
     * @param track {Song}
     */
    public set push(track: Song) {
        const names = this.status(track);
        const findSong = this.find((song) => track.url === song.url || song.title === track.title);

        if (findSong || track.duration.seconds >= 800 || names.status !== "not") return;

        //Проверяем путь на наличие директорий
        if (!existsSync(names.path)) {
            let dirs = names.path.split("/");

            if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
            mkdirSync(dirs.join("/"), {recursive: true});
        }

        super.push = track;
    };


    /**
     * @description Скачиваем трек
     * @param track {Song} Сам трек
     */
    protected readonly _next = (track: Song) => {
        if (debug) Logger.debug(`[AudioPlayer]: [Download]: ${track.url}`);

        return new Promise<boolean>((resolve) => {
            new httpsClient(track.link).request.then((req) => {
                if (req instanceof Error) return resolve(false);

                if (req.pipe) {
                    const status = this.status(track);
                    const file = createWriteStream(status.path);

                    file.once("ready", () => req.pipe(file));
                    file.once("error", console.warn);
                    file.once("finish", () => {
                        const refreshName = this.status(track).path.split(".raw")[0];

                        if (!req.destroyed) req.destroy();
                        if (!file.destroyed) file.destroy();

                        if (debug) Logger.debug(`[AudioPlayer]: [Download]: in ${refreshName}.opus`);

                        rename(status.path, `${refreshName}.opus`, () => null);

                        return resolve(true);
                    });
                }

                return resolve(false);
            });
        });
    };


    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track {Song}
     */
    public readonly status = (track: Song): {status: "not" | "final" | "download", path: string} => {
        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const fullPath = `${env.get("music.cache.dir")}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    };
}