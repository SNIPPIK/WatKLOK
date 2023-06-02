import { ShardManager } from "@Client/Shard";
import { WatKLOK } from "@Client";
import { Logger } from "@Logger";
import {env} from "@env";


if (process.argv.includes("--sharder")) new ShardManager();
else runShard();

/**
 * @description Запускаем один осколок
 */
function runShard() {
    const client = new WatKLOK();

    client.login(env.get("bot.token.discord")).then((): void => {
        if (env.get("bot.error.ignore")) process.on("uncaughtException", (err): void => {
            //Если выключено APIs.showErrors, то ошибки не будут отображаться
            if (!env.get("APIs.error.show") && err?.message?.match(/APIs/)) return;

            Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

            //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
            if (!env.get("APIs.error.send") && err?.message?.match(/APIs/)) return;

            try {
                const channel = client.channels.cache.get(env.get("channel.error.send")) as any;

                if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch((): void => {});
            } catch {/* Continue */ }
        });
    });
}