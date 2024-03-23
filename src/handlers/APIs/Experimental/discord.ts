import {Song} from "@lib/player/queue/Song";
import {API, Constructor} from "@handler";
import {Attachment} from "discord.js";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
export default class extends Constructor.Assign<API.request> {
    public constructor() {
        super({
            name: "DISCORD",
            audio: true,
            auth: true,

            color: 9807270,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi,
            url: "discord.com",

            requests: [
                /**
                 * @description Запрос данных о треке
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /attachments|ephemeral-attachments/,
                            //@ts-ignore
                            callback: (attachment: Attachment) => {
                                return new Promise<Song>((resolve) => {
                                    const track = new Song({
                                        title: attachment.name, author: null,
                                        image: {url: attachment.proxyURL},
                                        duration: {
                                            seconds: ((attachment.size / 1024) / 16.5).toFixed(0)
                                        },
                                        link: attachment.url, url: attachment.url
                                    })

                                    return resolve(track);
                                });
                            }
                        });
                    }
                }
            ]
        });
    };
}