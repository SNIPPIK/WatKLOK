import {ISong} from "@AudioPlayer/Queue/Song";
import Yandex from "../index";
import {API} from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.author");
export default class extends Yandex implements API.list {
    public readonly type = "album";
    public readonly filter = /album/;

    public readonly callback = (url: string) => {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID альбома не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

            try {
                //Создаем запрос
                const api = await this.API(`albums/${ID}/with-tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return reject(Error("[APIs]: Я не нахожу треков в этом альбоме!"));

                const AlbumImage = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                const tracks: ISong.track[] = (api["duplicates"] ?? api["volumes"])?.pop().splice(0, Limit);
                const Author = await this.getAuthor(api["artists"][0]?.id);

                const songs = tracks.map((track) => {
                    track.author = Author;
                    return this.track(track);
                });

                return resolve({ url, title: api.title, image: AlbumImage, author: Author, items: songs });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}