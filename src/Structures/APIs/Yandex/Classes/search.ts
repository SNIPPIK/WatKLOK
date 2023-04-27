import {YandexMusicUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Structures/Song";
import {API} from "@Structures/APIs";
import {APIs} from "@db/Config.json";

const Limit = APIs.limits.search;
export class YandexMusic_search implements API.array {
    public readonly type = "search";

    public readonly callback = (str: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await YandexMusicUtils.API(`search?type=all&text=${str.split(" ").join("%20")}&page=0&nococrrect=false`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если нет треков с таким названием
                if (!api.tracks) return reject(Error(`[APIs]: На Yandex music нет такого трека!`));

                const tracks = api.tracks.results.splice(0, Limit);

                return resolve(tracks.map(YandexMusicUtils.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}