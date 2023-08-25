import {FFprobe} from "@AudioPlayer/Audio/FFspace/FFprobe";
import {ISong} from "@AudioPlayer/Queue/Song";
import {API} from "@APIs";

export default class implements API.track {
    public readonly type = "track";
    public readonly filter = /http/;

    public readonly callback = (url: string) => {
        return new Promise<ISong.track>((resolve, reject) => {
            try {
                FFprobe(url).then((trackInfo: any) => {
                    //Если не найдена звуковая дорожка
                    if (!trackInfo) return null;

                    return resolve({
                        url, author: null, image: { url: null },
                        title: url.split("/").pop(),
                        duration: { seconds: trackInfo.format.duration },
                        format: { url: trackInfo.format.filename }
                    });
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}