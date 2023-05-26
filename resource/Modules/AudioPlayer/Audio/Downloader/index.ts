import {createWriteStream, existsSync, mkdirSync, rename} from "fs";
import {Song} from "@AudioPlayer/Queue/Song";
import {httpsClient} from "@httpsClient";
import {Logger} from "@Logger";
import {env} from "@env";


const debug = env.get("debug.player.cache");
const dir = env.get("music.cache.dir");

/**
 * @description Класс для кеширования треков, при использовании будет использоваться больше памяти и будут выполниться доп запросы
 */
class Downloader {
    private _songs: Song[] = [];

    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем трек в локальную базу
     * @param track {Song}
     */
    public set push(track: Song) {
        const names = this.status(track);
        const findSong = this._songs.find((song) => track.url === song.url || song.title === track.title);

        if (findSong || track.duration.seconds >= 800 || names.status !== "not") return;

        //Проверяем путь на наличие директорий
        if (!existsSync(names.path)) {
            let dirs = names.path.split("/");

            if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
            mkdirSync(dirs.join("/"), {recursive: true});
        }

        this._songs.push(track);

        //Запускаем скачивание
        if (this._songs.length === 1) this.cycleStep();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track {Song}
     */
    public readonly status = (track: Song): {status: "not" | "final" | "download", path: string} => {
        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const fullPath = `${dir}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запускаем цикл
     */
    private readonly cycleStep = () => {
        if (this._songs.length === 0) return;

        this.download = this._songs?.shift();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Скачиваем трек
     * @param track {Song} Сам трек
     * @private
     */
    private set download(track: Song) {
        if (debug) Logger.debug(`[AudioPlayer]: [Download]: ${track.url}`);

        new httpsClient(track.link).request.then((req) => {
            if (req instanceof Error) return setTimeout(this.cycleStep, 2e3);

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
                    setTimeout(this.cycleStep, 2e3);
                });
            }
        });
    };
}
export const DownloadManager = new Downloader();