import {Logger} from "@lib/discord";

/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class TimeCycle
 * @abstract
 */
export abstract class TimeCycle<T = unknown> {
    private readonly _temp = {
        array: [] as T[],
        time: 0
    };
    public readonly _config: TimeCycleConfig<T> = {
        name: "timeCycle",
        execute: null,
        filter: null,
        duration: 10e3,
        custom: {push: null}
    };
    protected constructor(options: TimeCycleConfig<T>) { Object.assign(this._config, options); };
    /**
     * @description Выдаем коллекцию
     * @public
     */
    public get array() { return this._temp.array; }

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public set = (item: T) => {
        if (this._config.custom?.push) this._config.custom?.push(item);
        else if (this._temp.array.includes(item)) this.remove(item);

        //Добавляем данные в цикл
        this._temp.array.push(item);

        //Запускаем цикл
        if (this._temp.array?.length === 1 && this._temp.time === 0) {
            Logger.log("DEBUG", `[Cycle/${this._config.name}]: Start cycle`);

            this._temp.time = Date.now();
            setImmediate(this._stepCycle);
        }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove = (item: T) => {
        if (this._temp.array?.length === 0) return;
        const index = this._temp.array.indexOf(item);

        if (index != -1) {
            if (this._config.custom?.remove) this._config.custom?.remove(item);
            this._temp.array.splice(index, 1);
        }
    };

    /**
     * @description Выполняем this._execute
     * @private
     */
    private _stepCycle = (): void => {
        if (this._temp.array?.length === 0) {
            Logger.log("DEBUG", `[Cycle/${this._config.name}]: Stop cycle`);
            this._temp.time = 0;
            return;
        }

        //Высчитываем время для выполнения
        this._temp.time += this._config.duration;

        for (let item of this._temp.array) {
            const filtered = this._config.filter(item);

            try {
                if (filtered) this._config.execute(item);
            } catch (error) {
                this.remove(item);
                Logger.log("WARN", `[Cycle/${this._config.name}]: Error in this._execute | ${error}`);
            }
        }

        //Выполняем функцию через ~this._time ms
        setTimeout(this._stepCycle, this._temp.time - Date.now());
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций TimeCycle
 */
interface TimeCycleConfig<T> {
    //Название цикла
    name: string;

    //Функция выполнения
    execute: (item: T) => void;

    //Функция фильтрации
    filter: (item: T) => boolean;

    //Время через которое надо запустить цикл
    duration: number;

    //Модификации цикла, не обязательно
    custom?: {
        //Изменить логику добавления
        push?: (item: T) => void;

        //Изменить логику удаления
        remove?: (item: T) => void;
    };
}