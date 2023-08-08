import {SpotifyUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.playlist");

export default class implements API.list {
    public readonly type = "playlist";
    public readonly filter = /playlist/;

    public readonly callback = (url: string) => {
        const ID = SpotifyUtils.getID(url);

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID плейлиста не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID плейлиста!"));

            try {
                //Создаем запрос
                const api: Error | any = await SpotifyUtils.API(`playlists/${ID}?offset=0&limit=${Limit}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve({
                    url, title: api.name, image: api.images[0],
                    // @ts-ignore
                    items: await Promise.all(api.tracks.items.map(({ track }) => SpotifyUtils.track(track))),
                    author: (await Promise.all([SpotifyUtils.getAuthor(`https://open.spotify.com/artist/${api.owner.id}`, api?.owner?.type !== "artist")]))[0]
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}