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

export default (queue: ArrayQueue, error: string | Error) => {
    const {color, author, image, title, url, requester} = queue.songs.song;

    new ActionMessage({
        message: queue.message, replied: true, time: 10e3,
        embeds: [
            {
                color, thumbnail: image.track, timestamp: new Date(),
                description: `\n[${title}](${url})\n\`\`\`js\n${error}...\`\`\``,
                author: {name: author.title, url: author.url, iconURL: local_db.image_disk},
                footer: {
                    text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                    iconURL: requester?.avatarURL()
                }
            }
        ]
    });
}