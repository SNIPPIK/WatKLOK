import {ISong} from "@AudioPlayer/Queue/Song";
import YouTube from "../index";
import {API} from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.search");

export default class extends YouTube implements API.array {
    public readonly type = "search";

    public readonly callback = (search: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                //Создаем запрос
                const details = await this.API(`https://www.youtube.com/results?search_query=${search.split(" ").join("+")}`);

                //Если при получении данных возникла ошибка
                if (details instanceof Error) return reject(details);

                let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                if (vanilla_videos.length === 0) return reject(Error(`[APIs]: Не удалось найти: ${search}`));

                let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, Limit);
                let videos = filtered_.map(({ videoRenderer }: any) => this.track(videoRenderer, true));

                return resolve(videos);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    };
}