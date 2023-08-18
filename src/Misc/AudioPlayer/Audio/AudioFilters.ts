import Filters from "@Json/Filters.json";
import {env} from "@env";

export { Filter, Filters, AudioFilters };

const volume = parseInt(env.get("music.audio.volume"));
const AudioFade = parseInt(env.get("music.audio.fade"));


namespace AudioFilters {
    /**
     * @description Ищем Filter в Array<Filter>
     * @param name {string} Имя фильтра
     */
    export function get(name: string): Filter {
        return Filters.find((fn) => fn.names.includes(name)) as Filter;
    }


    /**
     * @description Получаем множитель времени для правильного отображения. При добавлении новых аргументов в Filters.json<FilterConfigurator>, их нужно тоже добавить сюда!
     * @param filters {AudioFilters} Аудио фильтры которые включил пользователь
     */
    export function getDuration(filters: Filters): number {
        let duration: number = 20;

        if (filters.length > 0) filtersForEach(filters, (fl, filter: Filter) => {
            if (filter?.speed) { //Если у фильтра есть модификатор скорости
                if (typeof filter.speed === "number") duration *= Number(filter.speed);
                else duration *= Number(filters.slice(filters.indexOf(fl) + 1));
            }
        });

        return duration;
    }


    /**
     * @description Из названий фильтров получаем настоящие фильтры
     * @param filters {AudioFilters} Аудио фильтры которые включил пользователь
     * @param seek {number} Нужен для определения впервые включен ли поток
     */
    export function getRealFilters(filters: Filters, seek: number): string {
        const realFilters: Array<string> = [`volume=${volume / 100}`];

        //Включать более плавное включение музыки
        if (seek === 0) realFilters.push(`afade=t=in:st=0:d=${AudioFade}`);

        if (filters.length > 0) filtersForEach(filters, (fl, filter: Filter) => {
            if (filter) {
                if (!filter.args) return realFilters.push(filter.filter);

                const indexFilter = filters.indexOf(fl);
                realFilters.push(`${filter.filter}${filters.slice(indexFilter + 1)[0]}`);
            }
        });

        return realFilters.join(",");
    }
}


/**
 * @description Создаем фильтры для FFmpeg
 * @param filters {Filters} Аудио фильтры которые включил пользователь
 * @param callback {Function}
 */
function filtersForEach(filters: Filters, callback: (fl: string, filter: Filter) => void): void {
    filters.forEach((filter: string | number) => {
        if (typeof filter === "number") return;

        return callback(filter, AudioFilters.get(filter));
    });
}



/**
 * @description Допустимые фильтры для Queue
 */
type Filters = Array<string | number>;
/**
 * @description Как выглядит фильтр
 */
interface Filter {
    //Имена
    names: string[];

    //Описание
    description: string;

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number]

    //Меняется ли скорость
    speed?: null | number
}