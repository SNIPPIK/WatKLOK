import {ISong} from "@AudioPlayer/Queue/Song";
import {httpsClient} from "@Request";
import {env} from "@env";

//Локальная база данных
const db = {
    token: "",
    time: 0,

    api: "https://api.spotify.com/v1",
    link: "https://open.spotify.com",
    account: "https://accounts.spotify.com/api",
    aut: Buffer.from(env.get("bot.token.spotify")).toString("base64")
};

export default class Spotify {
    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    protected API = (method: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            const isLoggedIn = db.token !== undefined && db.time > Date.now() + 2;
            if (!isLoggedIn) await getToken();

            return new httpsClient(`${db.api}/${method}`, {
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + db.token,
                    "accept-encoding": "gzip, deflate, br"
                }, proxy: true
            }).toJson.then((api) => {
                if (!api) return resolve(Error("[APIs]: Не удалось получить данные!"));
                else if (api.error) return resolve(Error(`[APIs]: ${api.error.message}`));

                return resolve(api);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    }


    /**
     * @description Получаем ID трека, плейлиста, альбома
     * @param url {string} Ссылка на трек, плейлист, альбом
     */
    protected getID(url: string): string {
        if (typeof url !== "string") return undefined;

        return url?.split('/')?.at(-1);
    }


    /**
     * @description Получаем данные об авторе или пользователе
     * @param url {string} ссылка на автора или пользователя
     * @param isUser {boolean} Это пользователь
     */
    protected getAuthor(url: string, isUser: boolean = false): Promise<ISong.author> {
        const ID = this.getID(url);

        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await this.API(`${isUser ? "users" : "artists"}/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                return resolve({ // @ts-ignore
                    title: api?.name ?? api?.["display_name"], url,
                    image: api.images[0]
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }


    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     */
    protected track = async (track: any): Promise<ISong.track> => {
        const sortImages = track.album.images[0].width > track.album.images.pop().width ? track.album.images[0] : track.album.images.pop();

        return {
            title: track.name,
            url: track["external_urls"]["spotify"],
            author: (await Promise.all([this.getAuthor(track["artists"][0]["external_urls"]["spotify"], track?.["artists"][0]?.type !== "artist")]))[0],
            duration: { seconds: (track["duration_ms"] / 1000).toFixed(0) },
            image: sortImages,
        }
    }
}
/**
 * @description Получаем токен
 */
function getToken(): Promise<void> {
    return new httpsClient(`${db.account}/token`, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Basic ${db.aut}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "accept-encoding": "gzip, deflate, br"
        },
        body: "grant_type=client_credentials",
        method: "POST", proxy: true
    }).toJson.then((result) => {
        db.time = Date.now() + result["expires_in"];
        db.token = result["access_token"];
    });
}