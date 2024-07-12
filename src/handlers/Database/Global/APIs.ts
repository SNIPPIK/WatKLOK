import {API} from "@handler";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @abstract
 */
export class Database_APIs {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    protected readonly _platforms = {
        /**
         * @description Поддерживаемые платформы
         */
        supported: [] as API.request[],

        /**
         * @description Платформы с отсутствующими данными для авторизации
         */
        authorization: [] as API.platform[],

        /**
         * @description Платформы с возможностью получить аудио
         * По-умолчанию запрос идет к track
         */
        audio: [] as API.platform[],

        /**
         * @description Заблокированные платформы, только через owner.list
         */
        block: [] as API.platform[]
    };
    /**
     * @description База с лимитами обрабатываемых данных
     * @protected
     * @readonly
     */
    protected readonly _limits = {
        playlist: parseInt(env.get("APIs.limit.playlist")),
        album: parseInt(env.get("APIs.limit.album")),

        search: parseInt(env.get("APIs.limit.search")),
        author: parseInt(env.get("APIs.limit.author"))
    };

    /**
     * @description Получаем лимиты по запросам
     * @return object
     * @public
     */
    public get limits() { return this._limits; };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._platforms; };

    /**
     * @description Исключаем некоторые платформы из доступа
     * @public
     */
    public get allow() {
        return this._platforms.supported.filter((platform) => platform.name !== "DISCORD");
    };
}