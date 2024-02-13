import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Song} from "@watklok/player/queue/Song";
import {ActionMessage, Assign, PlayerEvent} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<PlayerEvent> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            execute: (queue: ArrayQueue, _: Song[]) => {
                const {color, author, image, title, url, duration, requester} = queue.songs.last;

                new ActionMessage({
                    message: queue.message, replied: true, time: 12e3,
                    embeds: [
                        {
                            color, thumbnail: image.track,
                            author: {name: author.title, iconURL: db.emojis.diskImage, url: author.url},
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
                })
            }
        });
    }
};