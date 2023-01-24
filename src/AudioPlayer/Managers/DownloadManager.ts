import {existsSync, createWriteStream, rename} from "fs";
import {replacer} from "@Structures/Handle/Command";
import {httpsClient} from "@httpsClient";
import {FileSystem} from "@FileSystem";
import {Music} from "@db/Config.json";
import {Song} from "@Queue/Song";

type DownloadSong = {title: string, author: string, duration: number, resource: string};
const QueueSongs: DownloadSong[] = [];

//Убираем в конце / чтобы не мешало
if (Music.CacheDir.endsWith("/")) Music.CacheDir.slice(Music.CacheDir.length - 1);

export namespace DownloadManager {
     /**
     * @description Добавление трека в очередь для плавного скачивания
     * @param track {Song} Трек который будет скачен
     * @param resource {string} Ссылка на ресурс
     */
    export function download(track: Song, resource: string): void {
        const findSong = QueueSongs.find((song) => song.title === track.title);
        const names = getNames(track);

        if (findSong || track.duration.seconds > 800 || names.status !== "not") return;

        //Проверяем путь на наличие директорий
        FileSystem.createDirs(names.path);

        //Добавляем трек в очередь для скачивания
         QueueSongs.push({title: track.title, author: track.author.title, duration: track.duration.seconds, resource});
        if (QueueSongs.length === 1) cycleStep();
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track {Song | DownloadSong} Трек
     */
    export function getNames(track: DownloadSong | Song): {status: "download" | "final" | "not", path: string} {
        const author = replacer.replaceArray((track as Song)?.author?.title ?? (track as DownloadSong)?.author, ["|", ",", "<", ">", ":", "\\", "/", "*", "?"]);
        const song = replacer.replaceArray(track.title, ["|", ",", "<", ">", ":", "\\", "/", "*", "?"]);
        const fullPath = `${Music.CacheDir}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Постепенное скачивание множества треков
 * @private
 */
function cycleStep(): void {
    const song = QueueSongs[0];

    if (!song) return;
    QueueSongs.shift();

    const names = DownloadManager.getNames(song);
    if (names.status === "final") return void setTimeout(() => cycleStep(), 2e3);

    setImmediate(() => {
        //Скачиваем трек
        httpsClient.Request(song.resource, {options: {keepAlive: true, userAgent: true}, request: {method: "GET"}}).then((req) => {
            if (req.pipe) {
                const file = createWriteStream(`./${names.path}`);

                file.once("ready", () => req.pipe(file));
                file.once("error", console.warn);
                ["close", "finish"].forEach(event => file.once(event, () => {
                    const refreshName = DownloadManager.getNames(song).path.split(".raw")[0];

                    rename(names.path, `${refreshName}.opus`, () => null);
                    void setTimeout(() => cycleStep(), 2e3);
                }));
            }
        });
    });
}