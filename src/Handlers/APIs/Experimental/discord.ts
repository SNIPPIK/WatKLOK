import {Process} from "@Client/Audio/Player/AudioResource";
import {Song} from "@Client/Audio/Queue/Song";
import {API} from "@handler";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @class initDiscord
 * @description Динамически загружаемый класс
 */
export default class implements API.load {
    public readonly name: API.platform = "DISCORD";
    public readonly audio = true;
    public readonly auth = false;
    public readonly color = 9807270;
    public readonly filter = /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi;
    public readonly url = "discord.com";
    public readonly requests = [
        /**
         * @author SNIPPIK
         * @class null
         * @description Получение трека из файла
         * @type API.track
         */
        new class implements API.track {
            public readonly type = "track";
            public readonly filter = /attachments/;

            public readonly callback = (url: string) => {
                return new Promise<Song>(async (resolve, reject) => {
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
                                format: { url: track.format.filename }
                            }));
                        });
                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                });
            }
        }
    ];
}