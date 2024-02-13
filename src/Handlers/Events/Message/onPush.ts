import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {ActionMessage, Assign, PlayerEvent} from "@handler";
import {Song} from "@watklok/player/queue/Song";
import {Duration} from "@watklok/player";
import {Colors} from "discord.js";
import {db} from "@Client/db";

export default class extends Assign<PlayerEvent> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            execute: (queue: ArrayQueue | ClientMessage, obj: Song | Song.playlist) => {

                if (queue instanceof ArrayQueue) {
                    const {color, author, image, title, url, duration, requester} = queue.songs.last;

                    if (obj instanceof Song) {
                        new ActionMessage({
                            message: queue.message, replied: true, time: 12e3,
                            embeds: [
                                {
                                    color, thumbnail: image,
                                    author: {name: author.title, iconURL: db.emojis.diskImage, url: author.url},
                                    footer: {
                                        text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                                        iconURL: requester.avatar
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
                        return;
                    }
                    return;
                } else if ("items" in obj) {
                    const {author, image, url, title, items} = obj;

                    new ActionMessage({
                        message: queue, replied: true, time: 12e3,
                        embeds: [
                            {
                                color: Colors.Blue, timestamp: new Date(),
                                author: {name: author?.title, url: author?.url, iconURL: db.emojis.diskImage},
                                thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.emojis.noImage},

                                footer: {
                                    text: `${queue.author.username} | ${Duration.getTimeArray(items)} | 🎶: ${items?.length}`,
                                    iconURL: queue.author.displayAvatarURL({})
                                },
                                fields: [
                                    {
                                        name: `**Найден плейлист**`,
                                        value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${items.length}**`
                                    }
                                ]
                            }
                        ]
                    })
                }
            }
        });
    }
};