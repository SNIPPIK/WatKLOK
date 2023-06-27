import {ISong} from "@AudioPlayer/Queue/Song";
import {YandexMusicUtils} from "../Utils";
import {API} from "@APIs";
import {env} from "@Client/Fs";

const Limit = env.get("APIs.limit.author");
export default class implements API.array {
    public readonly type = "artist";
    public readonly filter = /artist/;

    public readonly callback = (url: string) => {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise<ISong.track[]>(async (resolve, reject) => {
            //Если ID автора не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

            try {
                //Создаем запрос
                const api = await YandexMusicUtils.API(`artists/${ID}/tracks`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks = api.tracks.splice(0, Limit);

                return resolve(tracks.map(YandexMusicUtils.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}