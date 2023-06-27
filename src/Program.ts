import { ShardManager } from "@Client/Shard";
import { WatKLOK } from "@Client";
import { Logger } from "@Utils/Logger";
import {env} from "@Client/Fs";

class Program {
    /**
     * @description Запускаем ShardManager
     * @constructor
     */
    public readonly ShardManager = () => {
        const manager = new ShardManager(__filename);

        Logger.log("ShardManager has starting");

        //Ивент создания дубликата
        manager.on("shardCreate", (shard) => {
            shard.once("spawn", () => Logger.log(`Shard ${shard.id} has spawning...`));
            shard.once("ready", () => Logger.log(`Shard ${shard.id} has ready...`));
            shard.once("death", () => Logger.log(`Shard ${shard.id} has killed...`));
        });

        //Создаем дубликат
        manager.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };


    /**
     * @description Запускаем клиент
     * @constructor
     */
    public readonly Shard = () => {
        const client = new WatKLOK();

        client.login(env.get("bot.token.discord")).then((): void => {
            if (env.get("bot.error.ignore")) process.on("uncaughtException", (err): void => {
                //Если выключено APIs.showErrors, то ошибки не будут отображаться
                if (!env.get("APIs.error.show") && err?.message?.match(/APIs/)) return;

                Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

                //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
                if (!env.get("APIs.error.send") && err?.message?.match(/APIs/)) return;

                try {
                    const channel = client.channels.cache.get(env.get("channel.error")) as any;

                    if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch((): void => {});
                } catch {/* Continue */ }
            });
        });
    };
}

if (process.argv.includes("--sharder")) new Program().ShardManager();
else new Program().Shard();