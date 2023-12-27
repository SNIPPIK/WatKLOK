import {ActionMessage} from "@components/Client/ActionMessage";
import {env} from "@env";
import {ClientMessage} from "@handler/Events/Client/interactionCreate";
import {Song} from "@components/AudioClient/Queue/Song";
import {Colors} from "discord.js";
import {Duration} from "@components/AudioClient";
/**
 * @author SNIPPIK
 * @description Локальная база
 */
const local_db = {
    not_image: env.get("image.not"),
    image_disk: env.get("image.currentPlay")
};

export default (message: ClientMessage, playlist: Song.playlist) => {
    const {author, image, url, title, items} = playlist;

    new ActionMessage({
        message, replied: true, time: 12e3,
        embeds: [
            {
                color: Colors.Blue, timestamp: new Date(),
                author: {name: author?.title, url: author?.url, iconURL: local_db.image_disk},
                thumbnail: typeof image === "string" ? {url: image} : image ?? {url: local_db.not_image},

                footer: {
                    text: `${message.author.username} | ${Duration.getTimeArray(items)} | 🎶: ${items?.length}`,
                    iconURL: message.author.displayAvatarURL({})
                },
                fields: [
                    {
                        name: `**Найден плейлист**`,
                        value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${items.length}**`
                    }
                ]
            }
        ]
    });
}