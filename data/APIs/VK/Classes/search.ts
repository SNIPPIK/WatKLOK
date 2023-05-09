import {VkUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {APIs} from "@db/Config.json";
import {API} from "@APIs";

const Limit = APIs.limits.search;
export class VK_search implements API.array {
    public readonly type = "search";

    public readonly callback = (search: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await VkUtils.API("audio", "search", `&q=${search}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks = (api.response.items.splice(0, Limit)).map(VkUtils.track);

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}