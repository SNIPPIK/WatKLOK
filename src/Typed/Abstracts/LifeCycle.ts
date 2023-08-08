import {Logger} from "@Logger";
import {env} from "@env";

const debug_cycle = env.get("debug.cycle");

export abstract class LifeCycle<T> {
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
    protected readonly find = (callback: (data: T) => boolean): T => this._array.find(callback);


    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     */
    public set push(data: T) {
        if (this._array.includes(data)) return;
        this._array.push(data);

        //Запускаем цикл
        if (this._array.length === 1 && !this._timeout) {
            if (debug_cycle) Logger.debug(`[Cycle]: [${this.type}/${this.duration}]: Start cycle`);

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
            if (debug_cycle) Logger.debug(`[Cycle]: [${this.type}/${this.duration}]: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
            this._time = 0;
            return;
        }

        //Если тип обновления "multi" будет обработаны все объекты за раз в течении "this._duration"
        if (this.type === "multi") return this.CycleMulti();

        //Если тип обновления "single" будет обработан 1 объект затем 2
        return this.CycleSingle();
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

            try {
                //Отправляем его потом, поскольку while слишком быстро работает, могут возникнуть проблемы с потерями пакетов
                setImmediate(() => this._next(data));
            } catch (err) { this.removeErrorObject(err, data); }
        }

        //Выполняем функцию ~this._time ms
        this._timeout = setTimeout(this.CycleStep, this._time - Date.now());
    };


    /**
     * @description Обновляем один объект и ждем когда будет возврат
     */
    private readonly CycleSingle = () => {
        const array = this._array?.shift();

        (this._next(array) as Promise<boolean>).then(this.CycleStep).catch((err) => this.removeErrorObject(err, array));
    };


    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param object {any} Объект который будет удален
     */
    private readonly removeErrorObject = (err: string, object: T) => {
        //Удаляем объект выдающий ошибку
        this.remove = object;

        //Отправляем сообщение об ошибке
        Logger.error(`[Cycle]: [${this.type}/${this.duration}]: Error in this._next\n${err}\nRemove 1 object in cycle!`);
    };
}