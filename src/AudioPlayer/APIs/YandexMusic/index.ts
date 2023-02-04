import {InputPlaylist, InputTrack} from "@Queue/Song";
import {DurationUtils} from "@Managers/DurationUtils";
import {httpsClient} from "@httpsClient";

//====================== ====================== ====================== ======================
/**
 * У yandex.music нет API официального, но есть api для мобильных устройств
 * Это не система API а простой парсер страницы
 */
//====================== ====================== ====================== ======================

/**
 * @description Система запросов
 */
namespace API {
    /**
     * @description Делаем запрос на сайт yandex.music, и берем данные со страницы
     * @param url {string} Ссылка на объект
     * @param isFull {boolean} Нужны полные данные (используется только в SearchTracks)
     * @constructor
     */
    export function Request(url: string, isFull: boolean = false): Promise<Error | any> {
        return new Promise(async (resolve) => {
            const body = await httpsClient.parseBody(url, { request: { headers: { "accept-encoding": "gzip, deflate, br" }}});
            let info = "";

            //Если вместо запроса получаем ошибку
            if (body instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные со странницы!"));

            if (isFull) info = body?.split("\">var Mu=")[1]?.split(";</script><script src=")[0];
            else info = body?.split("/><script class=\"light-data\" type=\"application/ld+json\" nonce=\"")[1]?.split("\" >")[1]?.split("</script><link href=\"")[0];

            //Если страница пуста, то выводим ошибку
            if (!info) return resolve(Error("[APIs]: Не удалось получить данные со странницы!"));

            const json = JSON.parse(info);

            //Если нужна полная информация о странице
            if (json?.pageData) {
                if (json?.pageData === 404) return resolve(Error("[APIs]: Не удалось получить данные ошибка 404"));

                return resolve(json.pageData);
            }

            return resolve(json);
        });
    }
}
//====================== ====================== ====================== ======================

/**
 * @description Формирование общих данных
 */
namespace construct {
    export function track(track: any): InputTrack {
        const Author: any = track?.artists?.length ? track?.artists[0] : track.author;
        const Image: string = track.Image ?? track?.inAlbum?.image;
        const Albums = track.albums?.length ? track.albums[0] : track.albums;
        let trackName = (track?.title ?? track?.name);

        if (track?.version) trackName += ` - ${track.version}`;

        return {
            title: trackName, image: {url: Image},

            url: track?.url ?? `https://music.yandex.ru/album/${Albums.id}/track/${track.id}`,
            duration: {seconds: track?.durationMs ? (track.durationMs / 1000).toFixed(0) : parseDuration(track.duration)},

            author: track.author ?? {
                title: Author.name,
                url: `https://music.yandex.ru/artist/${Author.id}`,
                image: {url: Author.image},
                isVerified: true
            }
        };
    }
}
//====================== ====================== ====================== ======================

/**
 * @description Какие запросы доступны (какие были добавлены)
 */
export namespace YandexMusic {
    /**
     * @description Получаем данные о треке на YM
     * @param url {string} Ссылка на yandex music track
     */
    export function getTrack(url: string): Promise<InputTrack> {
        const ID = url.split(/[^0-9]/g).filter(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID трека или альбома не удалось извлечь из ссылки
            if (!ID[0]) return reject(Error("[APIs]: Не удалось получить ID альбома!"));
            else if (!ID[1]) return reject(Error("[APIs]: Не удалось получить ID трека!"));

            try {
                //Создаем запрос
                const api = await API.Request(`https://music.yandex.ru/album/${ID[0]}/track/${ID[1]}`);

                //Если запрос выдал ошибку или нет автора то
                if (api instanceof Error) return reject(api);
                else if (!api?.byArtist?.url) return reject(Error("[APIs]: Не удалось получить информацию о треке!"));

                api.url = url;
                api.author = await getAuthor(api.byArtist.url);
                return resolve(construct.track(api));
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные об альбоме
     * @param url {string} Ссылка на альбом
     */
    export function getAlbum(url: string): Promise<InputPlaylist> {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID альбома не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID альбома!"));

            try {
                //Создаем запрос
                const api = await API.Request(`https://music.yandex.ru/album/${ID}`);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const Image = api?.image;
                const MainArtist = await getAuthor(api.byArtist.url)

                return resolve({ url, title: api.name, image: {url: Image}, author: MainArtist,
                    items: api.track.map((track: any) => { track.author = MainArtist; track.Image = Image; return construct.track(track); })
                });
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем треки на yandex music
     * @param str {string} Что надо искать
     * @constructor
     */
    export function SearchTracks(str: string): Promise<InputTrack[]> {
        return new Promise(async (resolve, reject) => {
            try {
                //Создаем запрос
                const api = await API.Request(`https://music.yandex.ru/search?text=${str.split(" ").join("%20")}&type=tracks`, true);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);

                const tracks: InputTrack[] = [];
                let NumberTrack = 0;

                for (const track of api.result.tracks.items) {
                    if (NumberTrack === 15) break;

                    NumberTrack++;
                    tracks.push(construct.track(track))
                }

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем 5 популярных треков автора
     * @param url {string} Ссылка на автора
     */
    export function getArtistTracks(url: string): Promise<InputTrack[]> {
        const ID = url.split(/[^0-9]/g).find(str => str !== "");

        return new Promise(async (resolve, reject) => {
            //Если ID автора не удалось извлечь из ссылки
            if (!ID) return reject(Error("[APIs]: Не удалось получить ID автора!"));

            try {
                //Создаем запрос
                const api = await API.Request(`https://music.yandex.ru/artist/${ID}`, true);

                //Если запрос выдал ошибку то
                if (api instanceof Error) return reject(api);
                const tracks: InputTrack[] = [];

                //На главной странице всегда есть 5 популярных треков автора
                for (const track of api.tracks) tracks.push(construct.track(track));

                return resolve(tracks);
            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
        });
    }
}

//====================== ====================== ====================== ======================
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные об авторе трека
 * @param url {string} Ссылка на автора
 */
function getAuthor(url: string): Promise<InputTrack["author"]> {
    return new Promise(async (resolve, reject) => {
        try {
            //Создаем запрос
            const api = await API.Request(url);

            //Если запрос выдал ошибку то
            if (api instanceof Error) return reject(api);

            return resolve({url, title: api.name, image: {url: api.image}, isVerified: true });
        } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
    });
}
//====================== ====================== ====================== ======================
/**
 * @description У yandex.music странная система времени делаем ее нормальной
 * @param duration {string} Исходное время yandex.music
 */
function parseDuration(duration: string): string { //duration PT00H03M48S
    const parsedDuration = duration.split("PT")[1].replace(/[H,M]/gi, ":").split("S")[0];
    return `${DurationUtils.ParsingTimeToNumber(parsedDuration)}`;
}