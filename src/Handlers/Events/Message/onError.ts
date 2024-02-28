import {MessageConstructor} from "@Client/MessageConstructor";
import {Assign, Event} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<Event<"message/error">> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            execute: (queue, error) => {
                const {color, author, image, title, requester} = queue.songs.last;

                new MessageConstructor({ message: queue.message, replied: true, time: 10e3,
                    embeds: [
                        {
                            color, thumbnail: image, timestamp: new Date(),
                            fields: [
                                {
                                    name: `**Играл:**`,
                                    value: `\`\`\`${title}\`\`\``
                                },
                                {
                                    name: `**Error:**`,
                                    value: `\`\`\`js\n${error}...\`\`\``
                                }
                            ],
                            author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                            footer: {
                                text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                                iconURL: requester?.avatar
                            }
                        }
                    ]
                })
            }
        });
    }
};