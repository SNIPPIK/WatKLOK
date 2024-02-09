import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Logger} from "@Client";

/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class TimeCycle
 * @abstract
 */
export abstract class TimeCycle<T = unknown> {
    private readonly _array?: T[] = [];
    private _time?: number = 0;

    public readonly name = "Title";
    public readonly execute: (item: T) => void;
    public readonly filter: (item: T) => boolean;
    public readonly duration: number;

    protected constructor(options: {
        //Имя цикла
        name: string

        //Как выполнить функцию
        execute: (item: T) => void;

        //Фильтр объектов
        filter: (item: T) => boolean;

        //Через сколько времени выполнять функцию
        duration: number
    }) { Object.assign(this, options); };
    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     * @public
     */
    public push? = (data: T) => {
        if ("guild" in (data as ClientMessage)) {
            const old: T = this._array.find(msg => (msg as ClientMessage).guild.id === (data as ClientMessage).guild.id);

            //Если это-же сообщение есть в базе, то нечего не делаем
            if (old) this.remove(old);
        } else if (this._array.includes(data)) this.remove(data);
        this._array.push(data);

        //Запускаем цикл
        if (this._array?.length === 1) {
            Logger.log("DEBUG", `[Cycle/${this.name}]: Start cycle`);

            this._time = Date.now();
            setImmediate(this._asyncStep);
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
            if ("edit" in (data as ClientMessage)) {
                if ((data as ClientMessage) && (data as ClientMessage).deletable) (data as ClientMessage).delete().catch(() => undefined);
            }

            this._array.splice(index, 1);
        }
    };

    /**
     * @description Выполняем this._execute
     * @private
     */
    protected _asyncStep? = (): void => {
        //Если в базе больше нет объектов
        if (this._array?.length === 0) {
            Logger.log("DEBUG", `[Cycle/${this.name}]: Stop cycle`);
            this._time = 0;
            return;
        }

        //Высчитываем время для выполнения
        this._time += this.duration;

        for (let object of this._array.filter(this.filter)) {
            try {
                this.execute(object);
            } catch (err) {
                this._removeItem(err, object);
            }
        }

        //Выполняем функцию через ~this._time ms
        setTimeout(this._asyncStep, this._time - Date.now());
    };

    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param item {any} Объект который будет удален
     * @private
     */
    private _removeItem? = (err: string, item: T) => {
        Logger.log("WARN", `[Cycle/${this.name}]: Error in this._execute | ${err}`);
        this.remove(item);
    };
}