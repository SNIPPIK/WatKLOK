import { ISong } from "@AudioPlayer/Queue/Song";
import { API } from "@APIs";
import { env } from "@env";
import VK from "../index";

const Limit = env.get("APIs.limit.playlist");
export default class extends VK implements API.list {
    public readonly type = "playlist";
    public readonly filter = /playlist/;

    public readonly callback = (url: string) => {
        const PlaylistFullID = this.getID(url).split("_");
        const playlist_id = PlaylistFullID[1];
        const owner_id = PlaylistFullID[0];
        const key = PlaylistFullID[2];

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID не полный
            if (PlaylistFullID.length < 3) return reject(Error("[APIs]: ID плейлиста не полный!"));

            try {
                //Создаем запрос и получаем треки из этого плейлиста
                const api = await this.API("audio", "getPlaylistById", `&owner_id=${owner_id}&playlist_id=${playlist_id}&access_key=${key}`);
                const items = await this.API("audio", "get", `&owner_id=${owner_id}&album_id=${playlist_id}&access_key=${key}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error || items instanceof Error) return reject(api);

                const playlist = api.response;
                const image = playlist?.["thumbs"]?.length > 0 ? playlist?.["thumbs"][0] : null;
                const tracks = items?.response?.items?.splice(0, Limit);

                return resolve({
                    url, title: playlist.title,
                    items: tracks.map(this.track),
                    image: { url: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined }
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}