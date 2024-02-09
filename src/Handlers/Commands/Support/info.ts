import {Duration} from "@watklok/player";
import {Colors} from "discord.js";
import {Command} from "@handler";
import {db} from "@Client/db";
import {env} from "@env";
import os from "node:os";

const cpu = os.cpus();
const processor = cpu.length > 0 ? cpu[0]?.model : "Невозможно определить";
const bitrate = env.get("audio.bitrate");

export default class extends Command {
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

                    `> Память [${formatBytes(process.memoryUsage().rss / 1.5)}]`,
                    `   Используется   => [${formatBytes(process.memoryUsage().heapUsed)}]`,
                    `   Доступно       => [${formatBytes(process.memoryUsage().heapTotal)}]`
                ];

                let Music = [
                    `• Битрейт аудио    => ${bitrate}`,
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
                            text: `Latency - ${Latency} | Api - ${WS} | Uptime: ${Duration.parseDuration(client.uptime / 1000)}`,
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

function formatBytes(memory: number) {
    const sizes = ["Bytes", "", "MB", "GB"];
    const i = Math.floor(Math.log(memory) / Math.log(1024));
    return `${(memory / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}