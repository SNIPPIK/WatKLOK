import {Duration, ArraySort} from "@watklok/player";
import {Colors, EmbedData} from "discord.js";
import {Assign, Command} from "@handler";
import {db} from "@Client/db";


export default class extends Assign<Command> {
    public constructor() {
        super({
            name: "queue",
            description: "Показать всю музыку добавленную в очередь этого сервера?",

            execute: (message) => {
                const { author, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };
                else if (queue.songs.length === 1) return { content: `${author}, ⚠ | Играет всего один трек.`, color: "Yellow" };

                let num = 0;
                const pages = ArraySort(5, queue.songs.slice(1), (track) => { num++;
                    return `\`${num}\` - \`\`[${track.duration.full}]\`\` [${track.requester.username}](${track.author.url}) - [${track.title}](${track.url})`;
                }, "\n");
                const embed: EmbedData = {
                    title: `Queue - ${message.guild.name}`,
                    color: Colors.Green,
                    fields: [
                        {
                            name: `**Играет:**`,
                            value: `\`\`\`${queue.songs.song.title}\`\`\``
                        }
                    ],
                    footer: {
                        text: `${queue.songs.song.requester.username} | Лист 1 из ${pages.length} | Songs: ${queue.songs.length}/${Duration.getTimeArray(queue.songs)}`,
                        iconURL: queue.songs.song.requester.avatar
                    }
                };

                if (pages.length > 0) embed.fields.push({ name: "**Следующее:**", value: pages[0] });

                return {
                    embeds: [embed], pages, page: 1,
                    callback: (msg, pages: string[], page: number) => {
                        embed.fields[1] = { name: "**Следующее:**", value: pages[page - 1] };
                        const updateEmbed = { ...embed, footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}` } };

                        return msg.edit({ embeds: [updateEmbed] });
                    }
                };
            }
        });
    };
}