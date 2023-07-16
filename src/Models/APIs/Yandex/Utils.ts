import {httpsClient} from "@Request";
import {ISong} from "@AudioPlayer/Queue/Song";
import crypto from "node:crypto";
import {env} from "@env";

//Локальная база данных
const db = {
    token: env.get("bot.token.yandex"),

    api: "https://api.music.yandex.net",
    link: "https://music.yandex.ru"
};

export namespace YandexMusicUtils {
    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
    export function API(method: string): Promise<any> {
        return new Promise<any | Error>((resolve) => {
            return new httpsClient(`${db.api}/${method}`, {
                headers: { "Authorization": "OAuth " + db.token }, proxy: true
            }).toJson.then((req) => {
                if (!req) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (!db.token) return resolve(Error("[APIs]: Не удалось залогиниться!"));

                if (req?.result) return resolve(req?.result);
                return resolve(req);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Расшифровываем картинку
     * @param image {string} Ссылка на картинку
     * @param size {number} Размер картинки
     */
    export function onImage(image: string, size = 1e3): ISong.image {
        if (!image) return { url: "" };

        let img = image.split("%%")[0];

        return {
            url: `https://${img}m${size}x${size}`,
            width: size, height: size
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходный файл трека
     * @param ID {string} ID трека
     */
    export function getMp3(ID: string): Promise<string | Error> {
        return new Promise<string | Error>(async (resolve) => {
            try {
                const api = await API(`tracks/${ID}/download-info`);

                if (!api || api instanceof Error) return resolve(Error("[APIs]: Not found links for track!"));

                const track = api?.pop() ?? api;
                return new httpsClient(track.downloadInfoUrl).toXML.then((xml) => {
                    if (xml instanceof Error) return resolve(xml);

                    const path = xml[1];
                    const sign = crypto.createHash("md5").update("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + xml[4]).digest("hex");

                    return resolve(`https://${xml[0]}/get-mp3/${sign}/${xml[2]}${path}`);
                }).catch((e) => resolve(Error(e)));
            } catch (e) { return resolve(Error(e)); }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об авторе трека
     * @param ID {string} ID автора
     */
    export function getAuthor(ID: string): Promise<ISong.author> {
        return new Promise(async (resolve, reject) => {
            if (!ID) return resolve(null);

            try {
                //Создаем запрос
                const api = await API(`artists/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если мы получаем эту ошибку, то автора не существует
                if (api?.error && api?.error?.name === "unknown") return resolve(null);

                const author = api.artist;
                const image = onImage(author?.ogImage);

                return resolve({ url: `https://music.yandex.ru/artist/${ID}`, title: author.name, image: image });//, isVerified: true
            } catch (e) { return null }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек с Yandex Music
     */
    export function track(track: any): ISong.track {
        const author = track.artists?.length ? track.artists?.pop() : track.artists;
        const image = onImage(track?.ogImage || track?.coverUri);
        const album = track.albums?.length ? track.albums[0] : track.albums;
        const title = `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : "");

        return {
            title, image,

            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            duration: { seconds: (track.durationMs / 1000).toFixed(0) },

            author: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: { url: onImage(author?.ogImage ?? author?.coverUri) }
            }
        };
    }
}