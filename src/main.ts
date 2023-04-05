import { ShardManager } from "@Structures/ShardManager";
import { Bot, APIs, Channels } from "@db/Config.json";
import { ClientMessage } from "@Client/Message";
import { WatKLOK } from "@Client";
import { Logger } from "@Logger";

//Если указан --sharder
if (process.argv.includes("--sharder")) new ShardManager();
else {
    const client = new WatKLOK();

    client.login().then((): void => {
        if (Bot.ignoreErrors) process.on("uncaughtException", (err) => {
            //Если выключено APIs.showErrors, то ошибки не будут отображаться
            if (!APIs.showErrors && err?.message?.match(/APIs/)) return;

            Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

            //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
            if (!APIs.sendErrors && err?.message?.match(/APIs/)) return;

            try {
                const channel = client.channels.cache.get(Channels.sendErrors) as ClientMessage["channel"];

                if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch(() => null);
            } catch {/* Continue */ }
        });
    });
}