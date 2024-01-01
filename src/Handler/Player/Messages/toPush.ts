import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {env} from "@env";
import {ActionMessage} from "@Client";
/**
 * @author SNIPPIK
 * @description Локальная база
 */
const local_db = {
    image_disk: env.get("image.currentPlay")
};

export default (queue: ArrayQueue) => {
    const {color, author, image, title, url, duration, requester} = queue.songs.last;

    new ActionMessage({
        message: queue.message, replied: true, time: 12e3,
        embeds: [
            {
                color, thumbnail: image.track,
                author: {name: author.title, iconURL: local_db.image_disk, url: author.url},
                footer: {
                    text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                    iconURL: requester.avatarURL()
                },


                fields: [
                    {
                        name: "**Новый трек в очереди**",
                        value: `**❯** **[${title}](${url}})\n**❯** \`\`${duration.full}\`\`**`
                    }
                ]
            }
        ]
    });
}