import {SpotifyUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@APIs";

export default class implements API.track {
    public readonly type = "track";
    public readonly filter = /track/;

    public readonly callback = (url: string) => {
        const ID = SpotifyUtils.getID(url);

        return new Promise<ISong.track>(async (resolve, reject) => {
            //Если ID трека не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

            try {
                //Создаем запрос
                const api = await SpotifyUtils.API(`tracks/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve(SpotifyUtils.track(api as any));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}