import {History} from "@watklok/player/utils/History";
import {ArraySort} from "@watklok/player";
import { Colors } from "discord.js";
import {Command} from "@handler";

export default class extends Command {
    public constructor() {
        super({
            name: "history",
            description: "История прослушиваний этого сервера!",

            execute: (message) => {
                const { author } = message;

                //Если история отключена
                if (!History.enable) return { content: `${author}, история выключена!`, color: "Yellow" };

                const file = History.getFile(message.guildId);

                //Если нет файла
                if (!file) return { content: `${author}, на этом сервере еще не включали музыку!`, color: "Yellow" };

                const jsonFile = JSON.parse(file);

                //Создаем странички
                const pages = ArraySort<any>(10, jsonFile.tracks, (track) =>
                    `\`\`${track.platform.toUpperCase()}\`\` | \`\`${track.total}\`\` -> [${track.author.title}](${track.author.url}) - [${track.title}](${track.url})`, "\n"
                );

                //Создаем EMBED
                const embed = {
                    title: `История прослушиваний`, color: Colors.Gold, description: pages[0], timestamp: new Date(),
                    footer: { text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL() },
                }

                return { embeds: [embed], pages, page: 1,
                    callback: (msg, pages, page) => {
                        const updateEmbed = { ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}` } };

                        return msg.edit({ embeds: [updateEmbed] });
                    }
                };
            }
        });
    };
}