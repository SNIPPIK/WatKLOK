import {handler, Constructor} from "@handler";
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
class Command_Info extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "info",
            description: "Здесь показана моя информация!",

            execute: (message) => {
                const { client, guild } = message, queue = db.queue.get(guild.id);
                const Latency = (Date.now() - message.createdTimestamp < 0 ? Math.random() * 78 : Date.now() - message.createdTimestamp).toFixed(0);
                const WS = (client.ws.ping < 0 ? Math.random() * 78 : client.ws.ping).toFixed(0);

                let OS = [
                    `• Процессор: => ${processor}`,
                    `• Node:      => ${process.version}`,
                    `• Дубликатов => ${client?.shard?.ids?.length > 1 ? client.shard.ids.length : 1}\n`,

                    `• Дубликат [${client.ID}]`,
                    `• Серверов   => ${client.guilds.cache.size}`,
                    `• Каналов    => ${client.channels.cache.size}`,
                    `• Команд     => ${db.commands.size}`,

                    `> Память [${(process.memoryUsage().rss / 1.5).bytes()}]`,
                    `   Используется   => [${(process.memoryUsage().heapUsed).bytes()}]`,
                    `   Доступно       => [${(process.memoryUsage().heapTotal).bytes()}]`
                ];

                let Music = [
                    `• Битрейт аудио    => Auto`,
                    `• Макс очередь     => Infinite`,
                    `• Очереди          => ${db.queue.size}`,
                ];

                if (queue) {
                    let player = queue.player;

                    let infoPlayer = [
                        `\n> Плеер [${player.status}]`,
                        `   Voice      => ${!!player.connection}`,
                        `   Время      => ${player.stream?.duration ?? 0}`,
                        `   Играет     => ${player.playing ? "Да" : "Нет"}`,
                    ];

                    Music.push(...infoPlayer);
                }


                return {
                    embeds: [{
                        timestamp: new Date(), color: Colors.Green,
                        thumbnail: { url: client.user.displayAvatarURL() },
                        author: { name: "Разработчик: @snippik", iconURL: client.user.displayAvatarURL(), url: `https://t.me/snippik` },
                        title: `Информация`,
                        footer: {
                            text: `Latency - ${Latency} | Api - ${WS} | Uptime: ${(client.uptime / 1000).duration()}`,
                            iconURL: client.user.displayAvatarURL()
                        },

                        fields: [
                            {
                                name: "OS", value: `\`\`\`css\n${OS.join("\n")} \`\`\``
                            },
                            {
                                name: "Музыка", value: `\`\`\`css\n${Music.join("\n")} \`\`\``
                            },

                        ]
                    }], time: 30e3
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Info});