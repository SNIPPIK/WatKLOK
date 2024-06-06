import {Client, ShardManager} from "@lib/discord";
import process from "node:process";
import {Colors} from "discord.js";
import {env, Logger} from "@env";
import {db} from "@lib/db";

switch (
    process["argv"].includes("--ShardManager") ? 1 :
        process["argv"].includes("--RemoveAllCommands") ? 2 : 3) {
    /**
     * @name ShardManager
     * @description Загрузка менеджера осколков
     */
    case 1: {
        new ShardManager(__filename);
        break;
    }

    /**
     * @name "RemoveAllCommands"
     * @description Удаление всех команд бота
     */
    case 2: {
        const client = new Client();

        client.once("ready", () => {
            db.registerCommands(client).then(() => {
                Logger.log("LOG", `Removed all slash commands!`);
                Logger.log("WARN", `Need wait 30-60 minutes, pls not close application!`);
            });
        });

        client.login(env.get("token.discord")).then(() => {
            Logger.log("LOG", `[Shard ${client.ID}] is connected to websocket`);
        });

        break;
    }

    /**
     * @name "default"
     * @description Загрузка осколка
     */
    default: {
        //Если включен режим отладки, режим отладки запускается через --dbg
        if (process["argv"].includes("--dbg")) Logger.log("WARN", `[DEBUG MODE] Enabled...`);

        const client = new Client();

        /**
         * @description Подключаемся к api discord
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
            //Отправляем данные об ошибке и отправляем через систему webhook
            client.sendWebhook = {
                username: client.user.username, avatarURL: client.user.avatarURL(),
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

            //Если получена критическая ошибка, из-за которой будет нарушено выполнение кода
            if (err.message?.match(/WCritical/)) {
                Logger.log("ERROR", `[CODE: <14>]: Hooked critical error!`);
                process.exit(14);
                return;
            }

            //Если вдруг запущено несколько ботов
            else if (err.name?.match(/acknowledged./)) return Logger.log("WARN", `[CODE: <50490>]: Several bots are running!`);

            //Выводим ошибку
            Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
        });
        process.on("unhandledRejection", (err: Error) => console.error(err.stack));
    }
}