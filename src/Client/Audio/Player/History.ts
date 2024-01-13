import {Song} from "@Client/Audio/Queue/Song";
import {FileSystem} from "@src";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description История прослушиваний для серверов
 * @class History
 */
export class History {
    private readonly _guildID: string;
    private readonly _platform: string;
    private readonly _track: Song;
    public constructor(track: Song, GuildID: string, platform: string) {
        this._guildID = GuildID; this._track = track; this._platform = platform;

        //Если нет файла
        if (!this.file) this._createDir();

        setTimeout(() => {
            const file = JSON.parse(this.file);

            //Добавляем трек
            this._pushTrack(file.tracks);

            //Сортируем треки
            this._sortTracks(file.tracks);

            //Сохраняем файл
            FileSystem.saveToFile(this.path, file);
        }, 2e3);
    };
    /**
     * @description Получаем путь
     */
    private get path() { return `${env.get("cached.dir")}/Guilds/[${this._guildID}].json`; };

    /**
     * @description Загружаем файл
     */
    private get file() { return FileSystem.getFile(this.path); };


    /**
     * @description Проверяем работает ли история
     */
    public static get enable() { return env.get("history"); };


    /**
     * @description Добавляем трек в базу
     * @param tracks {Array<miniTrack>} Треки для сортировки
     */
    private _pushTrack = (tracks: Array<miniTrack>) => {
        const Found = (tracks as Array<miniTrack>).find((track) => track.title.includes(this._track.title) || track.url === this._track.url);

        //Если нет трека, то добавляем его
        if (!Found) {
            tracks.push({
                title: this._track.title,
                url: this._track.url,
                author: {
                    title: this._track.author.title,
                    url: this._track.author.url
                },

                platform: this._platform,
                total: 1
            })
        } else { //Если есть такой трек, то добавляем + к прослушиванию
            const index = tracks.indexOf(Found);
            tracks[index].total++;
        }
    };

    /**
     * @description Сортируем треки по популярности
     * @param tracks {Array<miniTrack>} Треки для сортировки
     */
    private _sortTracks = (tracks: Array<miniTrack>) => {
        //Если треков более 1, то сортируем по популярности
        if (tracks.length > 1) (tracks as Array<miniTrack>).sort((track1, track2) => {
            return track2.total - track1.total;
        });
    };

    /**
     * @description Если нет папки db/Guilds
     */
    private _createDir = () => FileSystem.saveToFile(this.path, { tracks: [] as Array<miniTrack> });
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