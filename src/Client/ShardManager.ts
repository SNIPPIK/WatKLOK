import { Shard, ShardingManager } from "discord.js";
import { Logger } from "@Logger";
import { env } from "src/_Handler/FileSystem/env";

/**
 * @description Используется для большого кол-ва серверов. Если у вас более 1к, тогда рекомендуется запускать ShardManager
 */
class ShardManager extends ShardingManager {
    public constructor() {
        super("./src/Client/Client.js", { token: env.get("TOKEN"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        Logger.log("[ShardManager]: starting...");

        //Ивент создания дубликата
        this.on("shardCreate", (shard: Shard) => {
            shard.once("spawn", () => Logger.log(`[ShardID: ${shard.id}]: spawning...`));
            shard.once("ready", () => Logger.log(`[ShardID: ${shard.id}]: ready...`));
            shard.once("death", () => Logger.log(`[ShardID: ${shard.id}]: killed...`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };
}
new ShardManager();