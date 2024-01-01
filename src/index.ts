import {ShardingManager} from "discord.js";
import {SuperClient} from "@Client";
import {env, Logger} from "@env";
import process from "process";
/**
 * @author SNIPPIK
 * @class ShardManager
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 */
class ShardManager extends ShardingManager {
    public constructor(path: string) {
        super(path, { token: env.get("token.discord"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        process.title = "ShardManager";
        Logger.log(`[ShardManager] has starting`);

        //Слушаем ивент для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log(`[Shard ${shard.id}] has added to manager`));
            shard.on("ready", () => Logger.log(`[Shard ${shard.id}] has a running`));
            shard.on("death", () => Logger.log(`[Shard ${shard.id}] has killed`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };
}

/**
 * @author SNIPPIK
 * @description Производим запуск
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new SuperClient();

    for (const event of ["SIGTERM", "SIGINT", "exit"]) {
        process.on(event, () => {
            client.destroy().catch(Logger.error);
            process.exit(0);
        });
    }

    client.asyncLogin().catch((err) => Logger.error(`[RoxClient]: ${err}`));
}

//Обрабатываем ошибки
process.on("uncaughtException", (err: Error) => {
    //Ловим ошибки
    if (err?.message?.match(/APIs/)) Logger.warn(`[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
    else if (err.name.match(/acknowledged./)) Logger.warn(`[CODE: <50490>]: [${err.name}/${err.message}]\nБоты не могут решить что выполнить! Отключите 1 дубликат!`);

    //Если не прописана ошибка
    else Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
});

//Обрабатываем не возвращенные данные
process.on("unhandledRejection", (reason) => console.log(reason));
export {db} from "@Client/db";