import {Shard, ShardingManager} from "discord.js";
import cfg from "../../DataBase/Config.json";

/**
 * @description Используется для большого кол-ва серверов. Если у вас более 1к, тогда рекомендуется запускать ShardManager
 */
class ShardManager extends ShardingManager {
    public constructor() {
        super("./src/Core/Client.js", {token: cfg.Bot.token, mode: "process", respawn: true, totalShards: "auto"});
        this.on("shardCreate", (shard: Shard) => {
            shard.once("spawn", () => console.log(`[ShardManager]: [ShardID: ${shard.id}, Type: Create]`));
            shard.once("ready", () => console.log(`[ShardManager]: [ShardID: ${shard.id}, Type: Ready]`));
            shard.once("death", () => console.log(`[ShardManager]: [ShardID: ${shard.id}, Type: Kill]`));
        });

        this.spawn({amount: "auto", delay: -1}).catch((err: Error) => console.log(`[ShardManager]: [Error]: ${err}`));
    };
}
new ShardManager();