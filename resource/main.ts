import { ShardManager } from "@Client/Shard";
import { Bot, APIs, Channels } from "@db/Config.json";
import { WatKLOK } from "@Client";
import { Logger } from "@Logger";
import {env} from "@env";

//Если указан --sharder
if (process.argv.includes("--sharder")) new ShardManager();
else {
    const client = new WatKLOK();

    client.login(env.get("TOKEN")).then((): void => {
        if (Bot.ignoreErrors) process.on("uncaughtException", (err) => {
            //Если выключено APIs.showErrors, то ошибки не будут отображаться
            if (!APIs.showErrors && err?.message?.match(/APIs/)) return;

            Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

            //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
            if (!APIs.sendErrors && err?.message?.match(/APIs/)) return;

            try {
                const channel = client.channels.cache.get(Channels.sendErrors) as any;

                if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch(() => {});
            } catch {/* Continue */ }
        });
    });
}