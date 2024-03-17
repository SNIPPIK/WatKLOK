import {Process} from "@lib/player/AudioResource";
import {Song} from "@lib/player/queue/Song";
import {API, Constructor} from "@handler";
import {env} from "@env";

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
                            filter: /attachments/,
                            callback: (url) => {
                                return new Promise<Song>((resolve, reject) => {
                                    try {
                                        const FFprobe = new Process(["-print_format", "json", "-show_format", "-i", url], env.get("ffprobe.path"));
                                        let temp = "";

                                        //Сохраняем данные в temp
                                        FFprobe.stdout.once("data", (data) => {
                                            if (data) temp += data.toString();
                                        });

                                        //При закрытии процесса выдаем данные
                                        FFprobe.process.once("close", () => {
                                            const track = JSON.parse(temp + "}");

                                            return resolve(new Song({
                                                url, author: null, image: { url: null },
                                                title: url.split("/").pop()?.split("?")[0],
                                                duration: { seconds: track.format.duration },
                                                link: track.format.filename
                                            }));
                                        });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    }
                }
            ]
        });
    };
}