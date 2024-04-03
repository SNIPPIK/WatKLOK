import {Client, ShardManager} from "@lib/discord";
import {spawnSync} from "node:child_process";
import {Colors} from "discord.js";
import * as path from "node:path";
import {env, Logger} from "@env";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Загружаем данные в зависимости от выбора
 */
if (process["argv"].includes("--ShardManager")) new ShardManager(__filename);
else {
    const client = new Client();

    /**
     * @description Подключаемся к api.discord
     */
    client.login(env.get("token.discord")).then(() => {
        //Запускаем загрузку модулей после инициализации бота
        client.once("ready", () => {
            Logger.log("LOG", `[Shard ${client.ID}] is connected to websocket`);
            db.initialize = client;
        });
    });

    /**
     * @description Удаляем копию клиента если процесс был закрыт
     */
    for (const event of ["exit"]) process.on(event, () => {
        Logger.log("DEBUG", "[Process]: is killed!");
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0);
    });

    /**
     * @description Ловим попытки сломать процесс
     */
    process.on("uncaughtException", (err: Error) => {
        if (err?.message?.match(/APIs/)) Logger.log("WARN", `[CODE: <90404>]: [${err.name}/${err.message}]\n${err.stack}`);
        else if (err.name?.match(/acknowledged./)) Logger.log("WARN", `[CODE: <50490>]: [${err.name}/${err.message}]\nЗапущено несколько ботов!\nЗакройте их через диспетчер!`);

        //Если не прописана ошибка
        else Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

        client.sendWebhook = {
            username: client.user.username,
            avatarURL: client.user.avatarURL(),
            embeds: [{
                title: "uncaughtException",
                description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                fields: [{
                    name: "Stack:",
                    value: `\`\`\`${err.stack}\`\`\``
                }],
                color: Colors.DarkRed,
            }],
        }
    });
    process.on("unhandledRejection", (err: Error) => console.error(err.stack));
}

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg/avconv
 */
(() => {
    const names = [`${env.get("cached.dir")}/FFmpeg/ffmpeg`, env.get("cached.dir"), env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    for (const name of ["ffmpeg", "avconv", ...names]) {
        try {
            const result = spawnSync(name, ['-h'], {windowsHide: true});
            if (result.error) continue;
            return env.set("ffmpeg.path", name);
        } catch {}
    }

    throw Error("FFmpeg/avconv not found!");
})();