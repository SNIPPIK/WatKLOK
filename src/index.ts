import {Atlas, Logger, ShardManager} from "@Client";
import process from "process";
import {env} from "@env";
import {db} from "@Client/db";

/**
 * @description Загружаем данные в зависимости от выбора
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new Atlas();

    client.login(env.get("token.discord")).then(() => {
        //Запускаем загрузку модулей после инициализации бота
        client.once("ready", async () => {
            Logger.log("LOG", `[Shard ${client.ID}] has connected for websocket`);
            await db.initHandler(client);
        });
    });

    for (const event of ["exit"]) process.on(event, () => {
        Logger.log("DEBUG", "[Process]: has be killed!");
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0)
    });
}