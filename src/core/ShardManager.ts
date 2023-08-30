import { ShardingManager } from "discord.js";
import { env } from "@env";

/**
 * @description Используется для большого кол-ва серверов. Если у вас более 1к, тогда рекомендуется запускать ShardManager
 */
export class ShardManager extends ShardingManager {
    public constructor(path: string) {
        super(path, { token: env.get("bot.token.discord"), mode: "process", respawn: true, totalShards: "auto", execArgv: ["-r", "tsconfig-paths/register"] });
        process.title = "ShardManager";
    };
}