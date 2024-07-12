import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {version} from "../../../../package.json";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {db} from "@lib/db";
import os from "node:os";

const cpu = os.cpus();
const processor = cpu.length > 0 ? cpu[0]?.model : "Невозможно определить";

/**
 * @class Command_Info
 * @command info
 * @description Публичные данные бота
 */
class Command_Info extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("info")
                .setDescription("Здесь показана моя информация!")
                .setDescriptionLocale({
                    "en-US": "My information is shown here!"
                })
                .json,
            execute: ({message}) => {
                const Latency = (Date.now() - message.createdTimestamp < 0 ? Math.random() * 78 : Date.now() - message.createdTimestamp).toFixed(0);
                const WS = (message.client.ws.ping < 0 ? Math.random() * 78 : message.client.ws.ping).toFixed(0);
                const { client, guild } = message, queue = db.audio.queue.get(guild.id);
                const OS_page = locale._(message.locale, "command.info.page", [
                   version, processor, process.version, client?.shard?.ids || 1,
                    client.ID, client.guilds.cache.size, client.channels.cache.size, db.audio.queue.size,
                    `${db.commands.length}/${db.commands.subCommands}`, (process.memoryUsage().rss / 1.5).bytes(),
                    (process.memoryUsage().heapUsed).bytes(), (process.memoryUsage().heapTotal).bytes()
                ]);
                return new MessageBuilder().addEmbeds([
                    {
                        timestamp: new Date(), color: Colors.Green,
                        title: locale._(message.locale, "command.info.title"),
                        thumbnail: {
                            url: client.user.displayAvatarURL()
                        },
                        author: {
                            name: locale._(message.locale, "command.info.author"),
                            iconURL: client.user.displayAvatarURL(),
                            url: `https://github.com/SNIPPIK`
                        },
                        footer: {
                            text: locale._(message.locale, "ping", [
                                Latency, WS, (client.uptime / 1000).duration()
                            ]),
                            iconURL: client.user.displayAvatarURL()
                        },
                        fields: [
                            {
                                name: locale._(message.locale, "command.info.os"),
                                value: `\`\`\`css\n${OS_page} \`\`\``
                            }
                        ]
                    }
                ]);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Info});