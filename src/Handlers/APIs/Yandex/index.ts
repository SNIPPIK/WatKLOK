import {ISong} from "@AudioPlayer/Queue/Song";
import {httpsClient} from "@Request";
import crypto from "node:crypto";
import {env} from "@env";

//Локальная база данных
const db = {
    token: env.get("bot.token.yandex"),

    api: "https://api.music.yandex.net",
    link: "https://music.yandex.ru"
};

export default class Yandex {
    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method {string} Путь
     * @constructor
     */
     protected API = (method: string): Promise<any> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient(`${db.api}/${method}`, {
                headers: { "Authorization": "OAuth " + db.token }, proxy: true
            }).toJson.then((req) => {
                if (!req) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (!db.token) return resolve(Error("[APIs]: Не удалось залогиниться!"));
                else if (req?.error?.name === "session-expired") return resolve(Error("[APIs]: Токен не действителен!"));

                if (req?.result) return resolve(req?.result);
                return resolve(req);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем исходный файл трека
     * @param ID {string} ID трека
     */
     protected getAudio = (ID: string): Promise<string | Error> => {
         return new Promise<string | Error>(async (resolve) => {
             try {
                 const api = await this.API(`tracks/${ID}/download-info`);

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
     };


    /**
     * @description Расшифровываем картинку
     * @param image {string} Ссылка на картинку
     * @param size {number} Размер картинки
     */
     protected parseImage = (image: string, size = 1e3) => {
         if (!image) return { url: "" };

         return {
             url: `https://${image.split("%%")[0]}m${size}x${size}`,
             width: size, height: size
         };
     };

    /**
     * @description Получаем данные об авторе трека
     * @param ID {string} ID автора
     */
    protected getAuthor = (ID: string): Promise<ISong.author> => {
        return new Promise(async (resolve, reject) => {
            if (!ID) return resolve(null);

            try {
                //Создаем запрос
                const api = await this.API(`artists/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                //Если мы получаем эту ошибку, то автора не существует
                if (api?.error && api?.error?.name === "unknown") return resolve(null);

                const author = api.artist;
                const image = this.parseImage(author?.ogImage);

                return resolve({ url: `https://music.yandex.ru/artist/${ID}`, title: author.name, image: image });//, isVerified: true
            } catch (e) { return null }
        });
    }


    /**
     * @description Из полученных данных подготавливаем трек для Player<Queue>
     * @param track {any} Любой трек с Yandex Music
     */
    protected track(track: any): ISong.track {
        const author = track.artists?.length ? track.artists?.pop() : track.artists;
        const image = this.parseImage(track?.ogImage || track?.coverUri);
        const album = track.albums?.length ? track.albums[0] : track.albums;
        const title = `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : "");

        return {
            title, image,

            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            duration: { seconds: (track.durationMs / 1000).toFixed(0) },

            author: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: { url: this.parseImage(author?.ogImage ?? author?.coverUri) }
            }
        };
    }
}