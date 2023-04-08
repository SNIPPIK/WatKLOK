import { existsSync, createWriteStream, rename } from "fs";
import { FileSystem } from "@Structures/FileSystem";
import { Song } from "@AudioPlayer/Structures/Song";
import { Music, Debug } from "@db/Config.json";
import { httpsClient } from "@httpsClient";
import { IncomingMessage } from "http";
import { Logger } from "@Logger";

type DownloadSong = { title: string, author: string, duration: number, resource: string };
const QueueDownload: DownloadSong[] = [];

//Убираем в конце / чтобы не мешало
if (Music.CacheDir.endsWith("/")) Music.CacheDir.slice(Music.CacheDir.length - 1);

export namespace DownloadManager {
    /**
    * @description Добавление трека в очередь для плавного скачивания
    * @param track {Song} Трек который будет скачен
    * @param resource {string} Ссылка на ресурс
    */
    export function download(track: Song, resource: string): void {
        const findSong = QueueDownload.find((song) => song.title === track.title);
        const names = getNames(track);

        if (findSong || track.duration.seconds > 800 || names.status !== "not") return;

        //Проверяем путь на наличие директорий
        FileSystem.createDirs(names.path);

        //Добавляем трек в очередь для скачивания
        QueueDownload.push({ title: track.title, author: track.author.title, duration: track.duration.seconds, resource });
        if (QueueDownload.length === 1) setImmediate(cycleStep);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track {Song | DownloadSong} Трек
     */
    export function getNames(track: DownloadSong | Song): { status: "download" | "final" | "not", path: string } {
        const author = ((track as Song)?.author?.title ?? (track as DownloadSong)?.author).replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const fullPath = `${Music.CacheDir}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Выбираем трек для скачивания
 */
function cycleStep(): void {
    setImmediate((): void => {
        const song = QueueDownload[0];

        if (!song) return;
        QueueDownload.shift();

        const names = DownloadManager.getNames(song);
        if (names.status === "final") return void setTimeout(() => cycleStep(), 2e3);

        return downloadTrack(song, names.path);
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Скачиваем трек по пути
 * @param song {DownloadSong} Сам трек
 * @param path {string} Путь для скачивания
 */
function downloadTrack(song: DownloadSong, path: string) {
    if (Debug) Logger.debug(`[DownloadManager]: [start]: [${song.duration}]: [${song.author}] - [${song.title}]`);

    //Скачиваем трек
    httpsClient.get(song.resource, { resolve: "full", useragent: true }).then((req: IncomingMessage) => {
        if (req instanceof Error) return;

        if (req.pipe) {
            const file = createWriteStream(`./${path}`);

            file.once("ready", () => req.pipe(file));
            file.once("error", console.warn);
            file.once("finish", () => {
                const refreshName = DownloadManager.getNames(song).path.split(".raw")[0];

                if (!req.destroyed) req.destroy();
                if (!file.destroyed) file.destroy();

                if (Debug) Logger.debug(`[DownloadManager]: [download]: in ${refreshName}.opus`);

                rename(path, `${refreshName}.opus`, () => null);
                void setTimeout(() => cycleStep(), 2e3);
            });
        }
    });
}