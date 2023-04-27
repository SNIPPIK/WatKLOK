import {SpotifyUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Structures/Song";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.playlist;

export class Spotify_album implements API.list {
    public readonly type = "album";
    public readonly filter = /album/;

    public readonly callback = (url: string) => {
        const ID = SpotifyUtils.getID(url);

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID альбома не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID альбома!"));

            try {
                //Создаем запрос
                const api: Error | any = await SpotifyUtils.API(`albums/${ID}?offset=0&limit=${Limit}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve({
                    url, title: api.name, image: api.images[0],
                    items: await Promise.all(api.tracks.items.map(SpotifyUtils.track)),
                    author: (await Promise.all([SpotifyUtils.getAuthor(`https://open.spotify.com/artist/${api?.artists[0].id}`, api?.artists[0]?.type !== "artist")]))[0]
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}