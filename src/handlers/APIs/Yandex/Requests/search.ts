import { ISong } from "@AudioPlayer/Queue/Song";
import Yandex from "../index";
import { API } from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.search")
export default class extends Yandex implements API.array {
    public readonly type = "search";

    public readonly callback = (str: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await this.API(`search?type=all&text=${str.split(" ").join("%20")}&page=0&nococrrect=false`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если нет треков с таким названием
                if (!api.tracks) return reject(Error(`[APIs]: На Yandex music нет такого трека!`));

                const tracks = api.tracks["results"].splice(0, Limit);

                return resolve(tracks.map(this.track));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}