import {ISong} from "@AudioPlayer/Queue/Song";
import Spotify from "../index";
import {API} from "@APIs";

export default class extends Spotify implements API.track {
    public readonly type = "track";
    public readonly filter = /track/;

    public readonly callback = (url: string) => {
        const ID = this.getID(url);

        return new Promise<ISong.track>(async (resolve, reject) => {
            //Если ID трека не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

            try {
                //Создаем запрос
                const api = await this.API(`tracks/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve(this.track(api));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}