import {Atlas, Logger, ShardManager} from "@Client";
import process from "node:process";
import {db} from "@Client/db";
import {env} from "@env";

/**
 * @description Загружаем данные в зависимости от выбора
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new Atlas();

    client.login(env.get("token.discord")).then(() => {
        //Запускаем загрузку модулей после инициализации бота
        client.once("ready", async () => {
            Logger.log("LOG", `[Shard ${client.ID}] is connected to websocket`);
            await db.initHandler(client);
        });
    });

    for (const event of ["exit"]) process.on(event, () => {
        Logger.log("DEBUG", "[Process]: is killed!");
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0)
    });
}



/**
 * Событие 'uncaughtException' генерируется, когда не перехваченное исключение JavaScript возвращается в цикл обработки событий.
 * По умолчанию Node.js обрабатывает такие исключения, печатая трассировку стека stderr завершая работу с кодом 1, переопределяя все ранее установленные process.exitCode.
 * Добавление обработчика события 'uncaughtException'переопределяет это поведение по умолчанию.
 * Альтернативно, измените process.exitCode обработчик 'uncaughtException', что приведет к завершению процесса с предоставленным кодом выхода.
 * В противном случае при наличии такого обработчика процесс завершится с 0.
 *
 * Original: https://nodejs.org/api/process.html#event-uncaughtException
 */
process.on("uncaughtException", (err: Error) => {
    if (err?.message?.match(/APIs/)) Logger.log("WARN", `[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
    else if (err.name?.match(/acknowledged./)) Logger.log("WARN", `[CODE: <50490>]: [${err.name}/${err.message}]\nЗапущено несколько ботов!\nЗакройте их через диспетчер!`);
    else if (err.name === undefined) return;

    //Если не прописана ошибка
    else Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
});

/**
 * Событие 'unhandledRejection' генерируется всякий раз, когда a Promise отклоняется и к обещанию не присоединяется обработчик ошибок в ходе цикла событий.
 * При программировании с использованием обещаний исключения инкапсулирующем как «отклоненные обещания».
 * Отклонения можно перехватывать и обрабатывать с помощью promise.catch() и распространять по Promise цепочке.
 * Это 'unhandledRejection' событие полезно для обнаружения и отслеживания отклоненных обещаний, отклонения которых еще не были обработаны.
 *
 * Original: https://nodejs.org/api/process.html#event-unhandledrejection
 */
process.on("unhandledRejection", (reason: string, promise) => {
    //if (reason?.match(/acknowledged./)) return;
    Logger.log("WARN", `\n┌ Name:    unhandledRejection\n├ Reason:  ${reason}\n└ Promise: ${promise}`);
});