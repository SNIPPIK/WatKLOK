import {ISong} from "@AudioPlayer/Queue/Song";
import {httpsClient} from "@httpsClient";


export namespace YouTubeUtils {
    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    export function getChannel({ id, name }: { id: string, name?: string }): Promise<ISong.author> {
        return new Promise(async (resolve) => {
            //Создаем запрос
            return new httpsClient(`https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00",
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                }
            }).toJson.then((channel) => {
                if (channel instanceof Error) return resolve(null);

                const data = channel[1]?.response ?? channel?.response ?? null as any;
                const info = data?.header?.c4TabbedHeaderRenderer, Channel = data?.metadata?.channelMetadataRenderer,
                    avatar = info?.avatar;

                return resolve({
                    title: Channel?.title ?? name ?? "Not found name",
                    url: `https://www.youtube.com/channel/${id}`,
                    image: avatar?.thumbnails.pop() ?? null
                });
            }).catch(() => resolve(null));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем ID
     * @param url {string} Ссылка
     * @param isPlaylist
     */
    export function getID(url: string, isPlaylist: boolean = false): string {
        try {
            if (typeof url !== "string") return null;
            const parsedLink = new URL(url);

            if (parsedLink.searchParams.get("list") && isPlaylist) return parsedLink.searchParams.get("list");
            else if (parsedLink.searchParams.get("v") && !isPlaylist) return parsedLink.searchParams.get("v");
            return parsedLink.pathname.split("/")[1];
        } catch (err) { return null; }
    }
}