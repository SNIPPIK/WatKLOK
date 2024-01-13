import {Event} from "@Client";
import {Logger} from "@src";


export default class uncaughtException extends Event<any> {
    constructor() {
        super({
            name: "uncaughtException",
            type: "process",
            execute: (_, err: Error) => {
                //Ловим ошибки
                if (err?.message?.match(/APIs/)) Logger.warn(`[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
                else if (err.name?.match(/acknowledged./)) Logger.warn(`[CODE: <50490>]: [${err.name}/${err.message}]\nБоты не могут решить что выполнить! Отключите 1 дубликат!`);
                else if (err.name === undefined) return;

                //Если не прописана ошибка
                else Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
            }
        });
    }
}