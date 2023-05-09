import {VkUtils} from "../Utils";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@APIs";

export class VK_track implements API.track {
    public readonly type = "track";
    public readonly filter = /audio/;

    public readonly callback = (url: string) => {
        const ID = VkUtils.getID(url);

        return new Promise<ISong.track>(async (resolve, reject) => {
            //Если ID трека не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не найден ID трека!"));

            try {
                //Создаем запрос
                const api = await VkUtils.API("audio", "getById", `&audios=${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const track = VkUtils.track(api.response.pop());

                return resolve(track);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}