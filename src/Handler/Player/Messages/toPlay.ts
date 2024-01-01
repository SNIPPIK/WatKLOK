import {ClientMessage} from "@handler/Events/Client/interactionCreate";
import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {Duration} from "@Client/Audio";
import {env} from "@env";
import {db} from "@Client/db";
import {ActionMessage} from "@Client";
/**
 * @author SNIPPIK
 * @description Локальная база
 */
const local_db = {
    ne_center: env.get("progress.not_empty.center"),
    ne_left: env.get("progress.not_empty.left"),
    ne_right: env.get("progress.not_empty.right"),
    bottom: env.get("progress.bottom"),
    e_center: env.get("progress.empty.center"),
    e_left: env.get("progress.empty.left"),
    e_right: env.get("progress.empty.right"),

    not_image: env.get("image.not"),
    image_disk: env.get("image.currentPlay")
};

export default (queue: ArrayQueue, isVoid = true) => {
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
        author: {name: author.title, url: author.url, iconURL: local_db.image_disk},
        footer: {
            text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
            iconURL: requester.avatarURL()
        }
    }

    //если надо отредактировать сообщение о текущем треке
    if (!isVoid) return embed;

    new ActionMessage({
        message: queue.message, embeds: [embed], time: 0, replied: true,
        components: [queue.components as any],
        promise: (msg: ClientMessage) => {
            db.music.queue.cycles.messages.push(msg);
        }
    });
}


/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class ProgressBar
 */
class ProgressBar {
    private readonly _current: number;
    private readonly _max: number;
    private readonly _size: number = 12;
    /**
     * @description Высчитываем прогресс бар
     */
    public get bar(): string {
        const size = this._size, current = this._current, max = this._max;
        const progressZ = Math.round(size * (isNaN(current) ? 0 : current / max));
        let progress: string = "";

        //Начало показа дорожки
        if (current > 0) progress += `${local_db.ne_left}`;
        else progress += `${local_db.e_left}`;

        //Середина дорожки + точка
        if (current === 0) progress += `${local_db.ne_center.repeat(progressZ)}${local_db.e_center.repeat((size + 1) - progressZ)}`;
        else if (current >= max) progress += `${local_db.ne_center.repeat(size)}`;
        else progress += `${local_db.ne_center.repeat(progressZ)}${local_db.bottom}${local_db.e_center.repeat(size - progressZ)}`;

        //Конец дорожки
        if (current >= max) progress += `${local_db.ne_right}`;
        else progress += `${local_db.e_right}`

        return progress;
    };

    public constructor(currentDur: number, max: number) {
        if (currentDur > max) this._current = max;
        else this._current = currentDur;

        this._max = max;
    };
}