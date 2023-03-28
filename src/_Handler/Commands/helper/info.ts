import {Command, ResolveData} from "@Handler/FileSystem/Handle/Command";
import {ClientMessage} from "@Client/interactionCreate";
import {DurationUtils} from "@Structures/Durations";
import {Colors} from "discord.js";
import pak from "package.json";
import os from "node:os";

const cpu = os.cpus();
const processor = cpu.length > 0 ? cpu[0]?.model : "Невозможно определить";

export class InfoCommand extends Command {
    public constructor() {
        super({
            name: "info",
            aliases: ["information"],
            description: "Здесь показана моя информация!",

            isGuild: true,
            isSlash: true,
            isEnable: true,

            isCLD: 10
        });
    };

    public readonly run = (message: ClientMessage): ResolveData => {
        const {client, guild} = message;
        const queue = client.player.queue;

        return {
            embed: {
                timestamp: new Date(), color: Colors.Green,
                thumbnail: { url: client.user.displayAvatarURL() },
                author: { name: "Информация" },
                fields: [
                    {
                        name: "Основные",
                        value: `**❯ Разработчик: SNIPPIK#4178 **\n**❯ Команд:** ${client.commands.size}\n**❯ Версия:** [${pak.version}]\n**❯ Процессор [${processor}]**`
                    },
                    {
                        name: "Статистика",
                        value: `\`\`\`css\n• Platform   => ${process.platform}\n• Node       => ${process.version}\n\n• Servers    => ${client.guilds.cache.size}\n• Channels   => ${client.channels.cache.size}\n\`\`\`\n`
                    },
                    {
                        name: "Музыка",
                        value: `\`\`\`css\n• Queue      => ${queue.size}\n• Player     => ${queue.get(guild.id) ? queue.get(guild.id).player.state.status : 'Is not a work player'}\`\`\``
                    }
                ],
                footer: {
                    text: `Latency - ${(Date.now() - message.createdTimestamp < 0 ? Math.random() * 78 : Date.now() - message.createdTimestamp).toFixed(0)} | Api - ${(client.ws.ping < 0 ? Math.random() * 78 : client.ws.ping).toFixed(0)} | Uptime: ${DurationUtils.ParsingTimeToString(client.uptime / 1000)}`,
                    iconURL: client.user.displayAvatarURL()
                }
            }
        }
    };
}