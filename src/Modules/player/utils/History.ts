import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {Song} from "@watklok/player/queue/Song";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description История прослушиваний для серверов
 * @class History
 */
export class History {
    private readonly _local = {
        track: null     as Song,
        guildID: null   as string
    };
    /**
     * @description Получаем путь
     * @return string
     * @private
     */
    private get path() {
        const path = env.get("cached.dir");

        return `${path}/Guilds/[${this._local.guildID}].json`;
    };

    /**
     * @description Проверяем работает ли история
     * @return boolean
     * @public
     * @static
     */
    public static get enable() {
        return env.get("history");
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
        this._local.guildID = GuildID; this._local.track = track;

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
        const track = tracks.find((track) => track.url === this._local.track.url);

        if (track) {
            const index = tracks.indexOf(track);
            tracks[index].total++;
            return;
        }

        tracks.push({
            title: this._local.track.title,
            url: this._local.track.url,
            author: {
                title: this._local.track.author.title,
                url: this._local.track.author.url
            },

            platform: this._local.track.platform,
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
 *  _____           _                    __
 * |_   _|         | |                  / _|
 *   | |    _ __   | |_    ___   _ __  | |_    __ _   ___    ___   ___
 *   | |   | '_ \  | __|  / _ \ | '__| |  _|  / _` | / __|  / _ \ / __|
 *  _| |_  | | | | | |_  |  __/ | |    | |   | (_| | \__ \ |  __/ \__ \
 * |_____| |_| |_|  \__|  \___| |_|    |_|    \__,_| |___/  \___| |___/
 */


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