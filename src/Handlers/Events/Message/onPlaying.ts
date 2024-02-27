import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ActionMessage, Assign, Event} from "@handler";
import {Duration} from "@watklok/player";
import {db} from "@Client/db";

export default class extends Assign<Event<"message/playing">> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            execute: (queue, isReturn) => {
                const {color, author, image, title, url, duration} = queue.songs.song;
                const embed = {
                    color, thumbnail: image,
                    author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                    fields: [
                        {
                            name: `**Играет:**`,
                            value: `\`\`\`${title}\`\`\``
                        }
                    ]
                };

                //Следующий трек
                if (queue.songs.size > 1) {
                    const tracks = queue.songs.slice(1, 5).map((track, index) => {
                        const title = `[${track.title.slice(0, 50)}](${track.url})`;

                        if (track.platform === "YOUTUBE") return `\`${index+2}.\` \`\`[${track.duration.full}]\`\` ${title}`;
                        return `\`${index+2}.\` \`\`[${track.duration.full}]\`\` [${track.author.title}](${track.author.url}) - ${title}`;
                    });

                    embed.fields.push({ name: `**Следующее:**`, value: tracks.join("\n") });
                }

                //Progress bar
                const currentTime = queue.player?.stream?.duration ?? 0;
                const progress = `\`\`${Duration.parseDuration(currentTime)}\`\` ${new ProgressBar(currentTime, duration.seconds).bar} \`\`${duration.full}\`\``;
                embed.fields.push({ name: " ", value: `\n[|](${url})${progress}` });

                if (isReturn) return embed;

                //Создаем и отправляем сообщение
                new ActionMessage({
                    message: queue.message, embeds: [embed], time: 0, replied: true,
                    components: [queue.components as any],
                    promise: (msg: ClientMessage) =>  { db.queue.cycles.messages.set(msg) }
                });
            }
        });
    }
};

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class ProgressBar
 */
class ProgressBar {
    private readonly _local = {
        current: 0,
        max:     0,
        size:    12
    };

    public constructor(currentDur: number, max: number) {
        if (currentDur > max) this._local.current = max;
        else this._local.current = currentDur;

        this._local.max = max;
    };

    /**
     * @description Высчитываем прогресс бар
     */
    public get bar(): string {
        const {progress} = db.emojis;
        const size =  this._local.size, current =  this._local.current, max =  this._local.max;
        const progressZ = Math.round(size * (isNaN(current) ? 0 : current / max));
        let bar: string = "";

        //Начало показа дорожки
        if (current > 0) bar += `${progress.upped.left}`;
        else bar += `${progress.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) bar += `${progress.upped.center.repeat(progressZ)}${progress.empty.center.repeat((size + 1) - progressZ)}`;
        else if (current >= max) bar += `${progress.upped.center.repeat(size)}`;
        else bar += `${progress.upped.center.repeat(progressZ)}${progress.bottom}${progress.empty.center.repeat(size - progressZ)}`;

        //Конец дорожки
        if (current >= max) bar += `${progress.upped.right}`;
        else bar += `${progress.empty.center}`;

        return bar;
    };
}