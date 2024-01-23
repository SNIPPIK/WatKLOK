import {Event} from "@handler";
import {Logger} from "@Client";

export default class uncaughtException extends Event<any> {
    constructor() {
        super({
            name: "uncaughtException",
            type: "process",
            execute: (_, err: Error) => {
                //Ловим ошибки
                if (err?.message?.match(/APIs/)) Logger.log("WARN", `[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
                else if (err.name?.match(/acknowledged./) || err?.name === undefined) Logger.log("WARN", `[CODE: <50490>]: [${err.name}/${err.message}]\nЗапущено несколько ботов!\nЗакройте их через диспетчер!`);

                //Если не прописана ошибка
                else Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
            }
        });
    }
}