import {ISong} from "@AudioPlayer/Queue/Song";
import YouTube from "../index";
import {API} from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.playlist");

export default class extends YouTube implements API.list {
    public readonly type = "playlist";
    public readonly filter = /playlist\?list=/gi;

    public readonly callback = (url: string) => {
        const ID = this.getID(url, true);

        return new Promise<ISong.playlist>(async (resolve, reject) => {
            //Если ID плейлиста не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

            try {
                //Создаем запрос
                const details = await this.API(`https://www.youtube.com/playlist?list=${ID}`);

                if (details instanceof Error) return reject(details);

                const info = details["sidebar"]["playlistSidebarRenderer"].items[0]["playlistSidebarPrimaryInfoRenderer"];
                const author = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                const contents: any[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"].content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"].splice(0, Limit);

                //Модифицируем видео
                const videos = contents.map(({playlistVideoRenderer}) => this.track(playlistVideoRenderer, true));

                return resolve({
                    title: info.title["runs"][0].text, url,
                    items: videos,
                    author: await this.getChannel({ id: author["navigationEndpoint"]["browseEndpoint"]["browseId"], name: author.title["runs"][0].text }),
                    image: info["thumbnailRenderer"]["playlistVideoThumbnailRenderer"].thumbnail["thumbnails"].pop()
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}