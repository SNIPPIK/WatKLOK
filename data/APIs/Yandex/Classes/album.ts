import {ISong} from "@AudioPlayer/Queue/Song";
import {YandexMusicUtils} from "../Utils";
import {API} from "@APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.playlist;
export class YandexMusic_album implements API.list {
    public readonly type = "album";
    public readonly filter = /album/;

    public readonly callback = (url: string) => {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID альбома не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

            try {
                //Создаем запрос
                const api = await YandexMusicUtils.API(`albums/${ID}/with-tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                else if (!api?.duplicates?.length && !api?.volumes?.length) return reject(Error("[APIs]: Я не нахожу треков в этом альбоме!"));

                const findTracks = (api.duplicates ?? api.volumes)?.pop();
                const AlbumImage = YandexMusicUtils.onImage(api?.ogImage ?? api?.coverUri);
                const tracks: ISong.track[] = findTracks.splice(0, Limit);
                const Author = await YandexMusicUtils.getAuthor(api.artists[0]?.id);

                const songs = tracks.map((track) => {
                    track.author = Author;
                    return YandexMusicUtils.track(track);
                });

                return resolve({ url, title: api.title, image: AlbumImage, author: Author, items: songs });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}