import { ISong } from "@AudioPlayer/Queue/Song";
import { API } from "@APIs";
import { env } from "@env";
import VK from "../index";

const Limit = env.get("APIs.limit.search");
export default class extends VK implements API.array {
    public readonly type = "search";

    public readonly callback = (search: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await this.API("audio", "search", `&q=${search}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks = (api.response.items.splice(0, Limit)).map(this.track);

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}