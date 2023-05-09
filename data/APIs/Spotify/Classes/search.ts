import {SpotifyUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {APIs} from "@db/Config.json";
import {API} from "@APIs";

const Limit = APIs.limits.search;

export class Spotify_search implements API.array {
    public readonly type = "search";

    public readonly callback = (search: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api: Error | any = await SpotifyUtils.API(`search?q=${search}&type=track&limit=${Limit}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve(await Promise.all(api.tracks.items.map(SpotifyUtils.track)));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}