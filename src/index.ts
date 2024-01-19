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

            //Загружаем модули
            for (const status of [
                await db.music.gettingFilters,
                await db.initHandler(client),
                await db.registerApplicationCommands(client)
            ]) {
                if (status instanceof Error) throw status;
            }
        });
    })

    for (const event of ["SIGTERM", "SIGINT", "exit"]) process.on(event, () => {
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0)
    });
}