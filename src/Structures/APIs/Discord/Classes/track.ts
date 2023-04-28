import {FFprobe} from "@AudioPlayer/Structures/Media/FFspace";
import {ISong} from "@AudioPlayer/Structures/Song";
import {Music} from "@db/Config.json";
import {API} from "@Structures/APIs";

export class Discord_track implements API.track {
    public readonly type = "track";
    public readonly filter = /attachments/;

    public readonly callback = (url: string) => {
        return new Promise<ISong.track>((resolve, reject) => {
            try {
                FFprobe(url).then((trackInfo: any) => {
                    //Если не найдена звуковая дорожка
                    if (!trackInfo) return null;

                    return resolve({
                        url, author: null, image: { url: Music.note },
                        title: url.split("/").pop(),
                        duration: { seconds: trackInfo.format.duration },
                        format: { url: trackInfo.format.filename }
                    });
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}