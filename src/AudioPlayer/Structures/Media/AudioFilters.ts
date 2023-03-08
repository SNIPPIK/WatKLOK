import { Music } from "@db/Config.json";
import Filters from "@db/Filters.json";

export { Filter, Filters, AudioFilters };

namespace AudioFilters {
    /**
     * @description Ищем Filter в Array<Filter>
     * @param name {string} Имя фильтра
     */
    export function get(name: string): Filter {
        return Filters.find((fn) => fn.names.includes(name)) as Filter;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем множитель времени для правильного отображения. При добавлении новых аргументов в Filters.json<FilterConfigurator>, их нужно тоже добавить сюда!
     * @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
     */
    export function getDuration(filters: Filters, duration: number = 20) {
        if (!filters) return duration;

        parse(filters, (fl, filter: Filter) => {

            //Если у фильтра есть модификатор скорости
            if (filter?.speed) {
                if (typeof filter.speed === "number") duration *= Number(filter.speed);
                else {
                    const Index = filters.indexOf(fl) + 1; //Позиция <filter> в AudioFilters
                    const number = filters.slice(Index); //Получаем то что указал пользователь

                    duration *= Number(number);
                }
            }
        });

        return duration;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из названий фильтров получаем настоящие фильтры
     * @param AudioFilters {AudioFilters} Аудио фильтры которые включил пользователь
     * @param seek {number} Нужен для определения впервые включен ли поток
     */
    export function getVanilaFilters(filters: Filters, seek: number): string {
        const response: Array<string> = [];

        //Включать более плавное включение музыки
        if (seek === 0) response.push("afade=t=in:st=0:d=3.5");
        response.push(`volume=${Music.Audio.volume / 100}`);

        if (filters) parse(filters, (fl, filter: Filter) => {
            if (filter) {
                if (!filter.args) return response.push(filter.filter);

                const indexFilter = filters.indexOf(fl);
                response.push(`${filter.filter}${filters.slice(indexFilter + 1)[0]}`);
            }
        });

        return response.join(",");
    }
    //====================== ====================== ====================== ======================
    /**
    * @description Создаем фильтры для FFmpeg
    * @param AudioFilters {Filters} Аудио фильтры которые включил пользователь
    * @param callback {Function}
    */
    function parse(filters: Filters, callback: (fl: string, filter: Filter) => void): void {
        filters.forEach((filter: string | number) => {
            if (typeof filter === "number") return;

            const findFilter = get(filter);

            return callback(filter, findFilter);
        });
    }
}

type Filters = Array<string | number>;

interface Filter {
    names: string[];
    description: string;
    filter: string;
    args: false | [number, number]
    speed?: null | number
};