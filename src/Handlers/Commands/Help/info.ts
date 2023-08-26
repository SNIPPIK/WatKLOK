import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";
import { Duration } from "@Util/Duration";
import { Colors } from "discord.js";
import {env} from "@env";
import os from "node:os";

const cpu = os.cpus();
const processor = cpu.length > 0 ? cpu[0]?.model : "Невозможно определить";
const bitrate = env.get("music.audio.bitrate");

export default class extends Command {
    public constructor() {
        super({
            name: "info",
            aliases: ["information"],
            description: "Здесь показана моя информация!",
            cooldown: 10
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { client, guild } = message;
        const queue = client.queue;
        const timeStamp = (Date.now() - message.createdTimestamp < 0 ? Math.random() * 78 : Date.now() - message.createdTimestamp).toFixed(0);
        const timeAPi = (client.ws.ping < 0 ? Math.random() * 78 : client.ws.ping).toFixed(0);

        return {
            embed: {
                timestamp: new Date(), color: Colors.Green,
                thumbnail: { url: client.user.displayAvatarURL() },
                author: { name: "Информация" },
                fields: [
                    {
                        name: "Основные",
                        value: `**❯ Разработчик: [@snippik](https://discordapp.com/users/312909267327778818) **\n**❯ Команд:** ${client.commands.size}\n**❯ Процессор [${processor}]**`
                    },
                    {
                        name: "Статистика",
                        value: `\`\`\`css\n• Platform   => ${process.platform}\n• Node       => ${process.version}\n• Shards     => ${client?.shard?.ids?.length > 1 ? client.shard.ids.length : 1}\n\n• Servers    => ${client.guilds.cache.size}\n• Channels   => ${client.channels.cache.size}\`\`\`\n`
                    },
                    {
                        name: "Музыка",
                        value: `\`\`\`css\n• Queue      => ${queue.size}\n• Player     => ${queue.get(guild.id) ? queue.get(guild.id).player.status : '0'}\n• Bitrate    => ${bitrate}\`\`\``
                    }
                ],
                footer: {
                    text: `Latency - ${timeStamp} | Api - ${timeAPi} | Uptime: ${Duration.toConverting(client.uptime / 1000)}`,
                    iconURL: client.user.displayAvatarURL()
                }
            }, lifeTime: 30e3
        }
    };
}