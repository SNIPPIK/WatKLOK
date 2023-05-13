import { Shard, ShardingManager } from "discord.js";
import { Logger } from "@Logger";
import { env } from "@env";

/**
 * @description Используется для большого кол-ва серверов. Если у вас более 1к, тогда рекомендуется запускать ShardManager
 */
export class ShardManager extends ShardingManager {
    public constructor() {
        super("resource/main.js", { token: env.get("TOKEN"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        Logger.log("[ShardManager]: starting...");

        //Ивент создания дубликата
        this.on("shardCreate", (shard: Shard) => {
            shard.once("spawn", () => Logger.log(`[${shard.id}]: spawning...`));
            shard.once("ready", () => Logger.log(`[${shard.id}]: ready...`));
            shard.once("death", () => Logger.log(`[${shard.id}]: killed...`));
        });

        //Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };
}