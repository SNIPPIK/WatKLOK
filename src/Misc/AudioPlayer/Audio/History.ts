import {ISong} from "@AudioPlayer/Queue/Song";
import {env} from "@env";
import {FileSystem} from "@Client/FileSystem";

/**
 * @description История прослушиваний для серверов, только для серверов не для пользователей
 */
export class History {
    private _guildID: string;
    private _platform: string;
    private _track: ISong.track;
    /**
     * @description Проверяем работает ли история
     */
    public static get enable() { return env.get("music.history"); };


    /**
     * @description Получаем путь
     */
    private get path() { return `${env.get("music.history.dir")}/[${this._guildID}].json`; };


    /**
     * @description Загружаем файл
     */
    private get file() { return FileSystem.getFile(this.path); };

    public constructor(track: ISong.track, GuildID: string, platform: string) {
        this._guildID = GuildID; this._track = track; this._platform = platform;
    };


    /**
     * @description Загружаем трек в историю
     */
    public get init() {
        //Если нет файла
        if (!this.file) this.createDir();

        setTimeout(() => {
            const file = JSON.parse(this.file);

            //Добавляем трек
            this.pushTrack(file.tracks);

            //Сортируем треки
            this.sortTracks(file.tracks);

            //Сохраняем файл
            FileSystem.saveToFile(this.path, file);
            
            this._track = null;
            this._platform = null;
            this._guildID = null;
        }, 2e3);

        return true;
    };


    /**
     * @description Добавляем трек в базу
     * @param tracks {Array<miniTrack>} Треки для сортировки
     */
    private pushTrack = (tracks: Array<miniTrack>) => {
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
    private sortTracks = (tracks: Array<miniTrack>) => {
        //Если треков более 1, то сортируем по популярности
        if (tracks.length > 1) (tracks as Array<miniTrack>).sort((track1, track2) => {
            return track2.total - track1.total;
        });
    };


    /**
     * @description Если нет папки db/Guilds
     */
    private createDir = () => {
        FileSystem.saveToFile(this.path, {
            tracks: [] as Array<miniTrack>
        });
    };
}

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