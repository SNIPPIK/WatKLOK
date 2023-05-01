import {SpotifyUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.author;

export class Spotify_artist implements API.array {
    public readonly type = "artist";
    public readonly filter = /artist/;

    public readonly callback = (url: string) => {
        const ID = SpotifyUtils.getID(url);

        return new Promise<ISong.track[]>(async (resolve, reject) => {
            //Если ID автора не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID автора!"));

            try {
                //Создаем запрос
                const api = await SpotifyUtils.API(`artists/${ID}/top-tracks?market=ES&limit=${Limit}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                // @ts-ignore
                return resolve(await Promise.all((api.tracks?.items ?? api.tracks).map(SpotifyUtils.track)));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}