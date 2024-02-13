import {Logger} from "@Client";

/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class TimeCycle
 * @abstract
 */
export abstract class TimeCycle<T = unknown> {
    public readonly _config: TimeCycleConfig<T> = {
        name: "timeCycle",
        execute: null,
        filter: null,
        duration: 10e3,
        custom: {push: null, remove: null}
    };
    protected constructor(options: TimeCycleConfig<T>) { Object.assign(this._config, options); };

    private readonly _array?: T[] = [];
    private _time?: number = 0;

    /**
     * @description Выдаем коллекцию
     * @public
     */
    public get array() { return this._array; }

    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     * @public
     */
    public set push(data: T) {
        if (this._config.custom?.push) this._config.custom?.push(data);
        else if (this._array.includes(data)) this.remove(data);

        //Добавляем данные в цикл
        this._array.push(data);

        //Запускаем цикл
        if (this._array?.length === 1) {
            Logger.log("DEBUG", `[Cycle/${this._config.name}]: Start cycle`);

            this._time = Date.now();
            setImmediate(this._stepCycle);
        }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param data {any} Сам элемент
     * @public
     */
    public remove? = (data: T) => {
        if (this._array?.length === 0) return;

        const index = this._array.indexOf(data);
        if (index != -1) {
            if (this._config.custom?.remove) this._config.custom?.remove(data);
            this._array.splice(index, 1);
        }
    };

    /**
     * @description Выполняем this._execute
     * @private
     */
    private _stepCycle? = (): void => {
        if (this._array?.length === 0) {
            Logger.log("DEBUG", `[Cycle/${this._config.name}]: Stop cycle`);
            this._time = 0;
            return;
        }

        //Высчитываем время для выполнения
        this._time += this._config.duration;


        for (const item of this._array.filter(this._config.filter)) {
            try {
                this._config.execute(item);
            } catch (error) {
                this._removeItem(error, item);
            }
        }

        //Выполняем функцию через ~this._time ms
        setTimeout(this._stepCycle, this._time - Date.now());
    };

    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param item {any} Объект который будет удален
     * @private
     */
    private _removeItem? = (err: string, item: T) => {
        Logger.log("WARN", `[Cycle/${this._config.name}]: Error in this._execute | ${err}`);
        this.remove(item);
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