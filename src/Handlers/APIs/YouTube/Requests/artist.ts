import {ISong} from "@AudioPlayer/Queue/Song";
import YouTube from "../index";
import {API} from "@APIs";
import {env} from "@env";

const Limit = env.get("APIs.limit.author")

export default class extends YouTube implements API.array {
    public readonly type = "artist";
    public readonly filter = /(channel)/gi || /@/gi;

    public callback = (url: string) => {
        return new Promise<ISong.track[]>(async (resolve, reject) => {
            try {
                let ID: string;

                if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                else ID = `channel/${url.split("channel/")[1]}`;

                //Создаем запрос
                const details = await this.API(`https://www.youtube.com/${ID}/videos`);

                if (details instanceof Error) return reject(details);

                const author = details["microformat"]["microformatDataRenderer"];
                const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                    ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, Limit);

                //Модифицируем видео
                const videos = contents.map(({richItemRenderer}: any) => {
                    const video = richItemRenderer?.content?.["videoRenderer"];

                    return {
                        url: `https://youtu.be/${video["videoId"]}`, title: video.title["runs"][0].text, duration: { seconds: video["lengthText"]["simpleText"] },
                        author: { url: `https://www.youtube.com${ID}`, title: author.title }
                    }
                });

                return resolve(videos);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)); }
        });
    };
}