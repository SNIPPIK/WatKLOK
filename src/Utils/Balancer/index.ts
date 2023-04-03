import {QueueCallbacks} from "@db/Config.json";

//Локальная база
const db = {
    //Очередь из функций
    queue: [] as callback[]
};

export namespace Balancer {
    /**
     * @description Добавляем функцию в обработку
     * @param callback {callback} Функция
     * @returns 
     */
    export function push(callback: callback): void {
        //Если выключено создаение очереди, то выполняем функцию незамедлительно
        if (!QueueCallbacks) return callback();

        db.queue.push(callback);

        if (db.queue.length === 1) return cycleStep();
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Постепенно обрабатываем функции
 * @returns 
 */
function cycleStep(): void {
    setImmediate((): void => {
        const callback = db.queue.shift();

        if (!callback) return;
        
        try { callback(); } 
        finally { return cycleStep(); }
    });
}

type callback = () => void;