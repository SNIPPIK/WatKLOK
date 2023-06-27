import {env} from "@Client/Fs";
import {Logger} from "@Utils/Logger";

const debug = env.get("debug.cycle");


export class LifeCycle<T> {
    //Как фильтровать <T>
    protected readonly _filter?: (data: T, index?: number) => boolean;
    //Что надо выполнять
    protected readonly _next: (data: T) => void | Promise<boolean>;
    //Время через которое будет выполниться _next
    protected readonly duration: number = 5e3;
    protected readonly type: "multi" | "single" = "multi";

    private readonly _array: T[] = [];
    private _timeout: NodeJS.Timeout = null;
    private _time: number = 0;

    /**
     * @description Ищем элемент в очереди
     */
    protected find = (callback: (data: T) => boolean): T => this._array.find(callback);


    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     */
    public set push(data: T) {
        if (this._array.includes(data)) return;
        this._array.push(data);

        //Запускаем цикл
        if (this._array.length === 1 && !this._timeout) {
            if (debug) Logger.debug(`Cycle: ${this.duration}: Start cycle`);

            this._time = Date.now();
            setImmediate(this.CycleStep);
        }
    };


    /**
     * @description Удаляем элемент из очереди
     * @param data {any} Сам элемент
     */
    public set remove(data: T) {
        const index = this._array.indexOf(data);
        if (index != -1) this._array.splice(index, 1);
    };


    /**
     * @description Жизненный цикл плееров
     */
    private readonly CycleStep = (): void => {
        //Если в базе больше нет плееров
        if (this._array.length === 0) {
            if (debug) Logger.debug(`Cycle: ${this.duration}: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
            this._time = null;
            return;
        }

        if (this.type === "single") return this.CycleSingle();
        return this.CycleMulti();
    };


    /**
     * @description обновляем постепенно Array
     */
    private readonly CycleMulti = () => {
        //Добавляем задержку, в размер пакета
        this._time += this.duration;

        //Проверяем плееры, возможно ли отправить аудио пакет
        const array = this._array.filter(this._filter);

        //Отправляем пакеты в плееры
        while (array.length > 0) {
            const data = array.shift();

            //Отправляем его потом, поскольку while слишком быстро работает, могут возникнуть проблемы с потерями пакетов
            setImmediate(() => this._next(data));
        }

        //Добавляем к времени еще 1 мс из-за while
        this._timeout = setTimeout(this.CycleStep, this._time - Date.now());
    };


    /**
     * @description Обновляем один объект и ждем когда будет возврат
     */
    private readonly CycleSingle = () => {
        const array = this._array?.shift();

        (this._next(array) as Promise<boolean>).then(this.CycleStep);
    };
}