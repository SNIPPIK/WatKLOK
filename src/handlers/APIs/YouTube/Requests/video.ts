import {ISong} from "@AudioPlayer/Queue/Song";
import YouTube from "../index";
import {API} from "@APIs";

export default class extends YouTube implements API.track {
    public readonly type = "track";
    public readonly filter = /(watch|embed|youtu\.be)/gi;

    public readonly callback = (url: string) => {
        const ID = this.getID(url);

        return new Promise<ISong.track>(async (resolve, reject) => {
            //Если ID видео не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

            try {
                //Создаем запрос
                const result = await this.API(`https://www.youtube.com/watch?v=${ID}&has_verified=1`);

                //Если возникла ошибка при получении данных
                if (result instanceof Error) return reject(result);

                const format = await this.extractStreamingData(result["streamingData"], result["html5"]);

                result["videoDetails"]["format"] = {url: format.url};

                return resolve(await this.track(result["videoDetails"], false));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)); }
        });
    };
}