import {ISong} from "@AudioPlayer/Queue/Song";
import {YandexMusicUtils} from "../Utils";
import {API} from "@APIs";

export default class implements API.track {
    public readonly type = "track";
    public readonly filter = /(album)?(track)/;

    public readonly callback = (url: string) => {
        const ID = url.split(/[^0-9]/g).filter(str => str !== "");

        return new Promise<ISong.track>(async (resolve, reject) => {
            try {
                if (ID.length < 2) return reject(Error("[APIs]: Не найден ID трека!"));

                const api = await YandexMusicUtils.API(`tracks/${ID[1]}`);

                if (api instanceof Error) return reject(api);

                api[0].author = await YandexMusicUtils.getAuthor(api[0]?.artists[0].id);
                const track = YandexMusicUtils.track(api[0]);
                const audio = await YandexMusicUtils.getMp3(ID[1]);

                if (audio instanceof Error) return resolve(track);
                else track.format = {url: audio};

                return resolve(track);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}