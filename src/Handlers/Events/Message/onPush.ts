import {ArrayQueue} from "@watklok/player/queue/Queue";
import {ActionMessage, Assign, Event} from "@handler";
import {Song} from "@watklok/player/queue/Song";
import {Duration} from "@watklok/player";
import {Colors} from "discord.js";
import {db} from "@Client/db";

export default class extends Assign<Event<"message/push">> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            execute: (queue, obj) => {
                let options: any;

                //Если был добавлен трек
                if (queue instanceof ArrayQueue) {
                    const {color, author, image, title, duration} = obj as Song;
                    options = { message: queue.message, replied: true, time: 12e3, embeds: [
                            {
                                color, thumbnail: image,
                                author: {name: author.title, iconURL: db.emojis.diskImage, url: author.url},
                                footer: {
                                    text: `${duration.full} | 🎶: ${queue.songs.size}`
                                },
                                fields: [
                                    {
                                        name: "**Добавлен трек:**",
                                        value: `\`\`\`${title}\`\`\`\ `
                                    }
                                ]
                            }
                        ]
                    }
                //Если был добавлен плейлист
                } else if ("items" in obj) {
                    const {author, image, title, items} = obj;
                    options = { message: queue, replied: true, time: 20e3,
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
                                        name: `**Добавлен плейлист:**`,
                                        value: `\`\`\`${title}\`\`\`\ `
                                    }
                                ]
                            }
                        ]
                    }
                }

                //Создаем и отправляем сообщение
                new ActionMessage(options);
            }
        });
    }
};
