import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ActionMessage, Assign, PlayerEvent} from "@handler";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Duration} from "@watklok/player";
import {db} from "@Client/db";

export default class extends Assign<PlayerEvent> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            execute: (queue: ArrayQueue, IsReturn?: boolean) => {
                const {color, author, image, requester, title, url, duration} = queue.songs.song;

                //Делаем заготовку для progress bar'а
                const currentTime = queue.player?.stream?.duration ?? 0;
                const progress = `\`\`${Duration.parseDuration(currentTime)}\`\` ${new ProgressBar(currentTime, duration.seconds).bar} \`\`${duration.full}\`\``;
                const fields = [
                    {
                        name: `**Сейчас играет**`,
                        value: `**❯** **[${title}](${url})**\n${progress}`
                    }
                ];

                //Следующий трек
                if (queue.songs.size > 1) {
                    const song = queue.songs[1];
                    fields.push({name: `**Следующий трек**`, value: `**❯** **[${song.title}](${song.url})**`});
                }
                const embed = {
                    color, thumbnail: image.track, fields,
                    author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                    footer: {
                        text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
                        iconURL: requester.avatarURL()
                    }
                }

                if (!IsReturn) {
                    new ActionMessage({
                        message: queue.message, embeds: [embed], time: 0, replied: true,
                        components: [queue.components as any],
                        promise: (msg: ClientMessage) =>  { db.queue.cycles.messages.push = msg }
                    });
                    return;
                }
                return embed;
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