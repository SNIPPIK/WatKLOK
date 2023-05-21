import { ClientMessage } from "@Client/Message";
import {Colors, EmbedData} from "discord.js";
import { WatKLOK } from "@Client";
import { Platform } from "@APIs";
import { Queue } from "../Queue/Queue";
import { ISong, Song } from "../Queue/Song";
import { DurationUtils } from "@Utils/Durations";
import {env} from "@env";

const note = env.get("music.note");
const Bar = {
    enable: env.get("bar"),
    full: env.get("bar.full"),
    empty: env.get("bar.empty"),

    button: env.get("bar.button")
}


//Здесь хранятся все EMBED данные о сообщениях (Используется в Managers/Player/Messages)
export namespace EmbedMessages {
    /**
     * @description JSON<EMBED> для отображения текущего трека
     * @param queue {Queue} Очередь
     */
    export function toPlaying(queue: Queue): EmbedData {
        const { color, author, image, requester } = queue.song;
        const fields = getFields(queue);
        const AuthorSong = replaceText(author.title, 45, false);

        return {
            color, image: image.track, thumbnail: image.author, fields,
            author: { name: AuthorSong, url: author.url, iconURL: note },
            footer: { text: `${requester.username} | ${DurationUtils.getTracksTime(queue)} | 🎶: ${queue.songs.length}`, iconURL: requester.avatarURL() }
        };
    }

    //====================== ====================== ====================== ======================

    /**
     * @description JSON<EMBED> для отображения добавленного трека
     * @param song {Song} Трек который был добавлен
     * @param songs {Queue<songs>} Все треки
     */
    export function toPushSong(song: Song, { songs }: Queue): EmbedData {
        const { color, author, image, title, url, duration, requester } = song;
        const AuthorSong = replaceText(author.title, 45, false);
        const fields = [{ name: "**Добавлено в очередь**", value: `**❯** **[${replaceText(title, 40, true)}](${url}})\n**❯** \`\`[${duration.full}]\`\`**` }];

        return {
            color, fields, thumbnail: image.track,
            author: { name: AuthorSong, iconURL: image.author.url, url: author.url },
            footer: { text: `${requester.username} | ${DurationUtils.getTracksTime(songs)} | 🎶: ${songs.length}`, iconURL: requester.avatarURL() }
        };
    }

    //====================== ====================== ====================== ======================

    /**
     * @description JSON<EMBED> для отображения данных плейлиста
     * @param DisAuthor {ClientMessage.author} Автор сообщения
     * @param playlist {ISong.playlist} Плейлист
     */
    export function toPushPlaylist({ author: DisAuthor }: ClientMessage, playlist: ISong.playlist): EmbedData {
        const { author, image, url, title, items } = playlist;

        return {
            color: Colors.Blue, timestamp: new Date(),
            author: { name: author?.title, url: author?.url },
            thumbnail: { url: author?.image?.url ?? note },
            image: typeof image === "string" ? { url: image } : image ?? { url: note },
            fields: [{ name: `**Найден плейлист**`, value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${playlist.items.length}**` }],
            footer: { text: `${DisAuthor.username} | ${DurationUtils.getTracksTime(items)} | 🎶: ${items?.length}`, iconURL: DisAuthor.displayAvatarURL({}) }
        };
    }

    //====================== ====================== ====================== ======================

    /**
     * @description JSON<EMBED> для отображения ошибки
     * @param client {WatKLOK} Клиент
     * @param color {Song<color>} Цвет
     * @param songs {Queue<songs>} Все треки
     * @param err {Error} Ошибка выданная плеером
     */
    export function toError(client: WatKLOK, { songs, song }: Queue, err: Error | string): EmbedData {
        const { color, author, image, title, url, requester } = song;
        const AuthorSong = replaceText(author.title, 45, false);

        return {
            color, thumbnail: image.track, timestamp: new Date(),
            description: `\n[${title}](${url})\n\`\`\`js\n${err}...\`\`\``,
            author: { name: AuthorSong, url: author.url, iconURL: image.author.url },
            footer: { text: `${requester.username} | ${DurationUtils.getTracksTime(songs)} | 🎶: ${songs.length}`, iconURL: requester?.avatarURL() ?? client.user.displayAvatarURL() }
        };
    }

    //====================== ====================== ====================== ======================

    /**
     * @description JSON<Embed> для отображения найденных треков
     * @param tracks {ISong.track[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param author {message.author} Автор запроса
     */
    export function toSearch(tracks: ISong.track[], platform: string, author: ClientMessage["author"]): EmbedData {
        return {
            color: Platform.color(platform as any),
            title: `Найдено ${tracks.length}`,
            footer: { text: `${author.username} | Платформа: ${platform}`, iconURL: author.avatarURL() },
            timestamp: new Date(),

            fields: tracks.map((track, index) => {
                const duration = platform === "YOUTUBE" ? track.duration.seconds : DurationUtils.toString(parseInt(track.duration.seconds));
                const title = `[${replaceText(track.title, 80, true)}](${track.url})`; //Название трека
                const author = `${replaceText(track.author.title, 30, true)}`; //Автор трека

                index++;

                return {
                    name: `${index}: _${author} | ${duration ?? "LIVE"}_`,
                    value: `__**❯** ${title}__\n\n`
                }
            }),
        };
    }
}


//====================== ====================== ====================== ======================
/*                                   Function for toPlay                                   */
//====================== ====================== ====================== ======================
/**
 * @description Создаем Message<Fields>
 * @param queue {Queue} Очередь
 */
function getFields(queue: Queue): EmbedData["fields"] {
    const { songs, song, player } = queue;
    const VisualDuration = toString(song.duration, player.duration);

    //Текущий трек
    const fields = [{ name: `**Сейчас играет**`, value: `**❯** **[${replaceText(song.title, 29, true)}](${song.url})**\n${VisualDuration}` }];

    //Следующий трек
    if (songs.length > 1) fields.push({ name: `**Следующий трек**`, value: `**❯** **[${replaceText(songs[1].title, 29, true)}](${songs[1].url})**` });
    return fields;
}

//====================== ====================== ====================== ======================

/**
 * @description Получаем время трека для embed сообщения
 * @param duration
 * @param playDuration
 */
function toString(duration: { seconds: number, full: string }, playDuration: number): string {
    if (duration.full === "Live" || !Bar.enable) return `\`\`[${duration.full}]\`\``;

    const parsedDuration = DurationUtils.toString(playDuration);
    const progress = matchBar(playDuration, duration.seconds);
    const string = `**❯** \`\`[${parsedDuration} \\ ${duration.full}]\`\``;

    return `${string}\n\`\`${progress}\`\``;
}

//====================== ====================== ====================== ======================

/**
 * @description Вычисляем прогресс бар
 * @param currentTime {number} Текущие время
 * @param maxTime {number} Макс времени
 * @param size {number} Кол-во символов
 */
function matchBar(currentTime: number, maxTime: number, size: number = 25): string {
    try {
        const CurrentDuration = isNaN(currentTime) ? 0 : currentTime;
        const progressSize = Math.round(size * (CurrentDuration / maxTime));
        const progressText = Bar.full.repeat(progressSize);
        const emptyText = Bar.empty.repeat(size - progressSize);

        return `${progressText}${Bar.button}${emptyText}`;
    } catch (err) {
        if (err === "RangeError: Invalid count value") return "**❯** \`\`[Error value]\`\`";
        return "**❯** \`\`[Loading]\`\`";
    }
}

//====================== ====================== ====================== ======================

/**
 * @description Обрезает текст до необходимых значений
 * @param text {string} Текст который надо изменить
 * @param value {number} До скольки символов надо обрезать текст
 * @param clearText {boolean} Надо ли очистить от [\[,\]}{"`'*]()
 */
function replaceText(text: string, value: number | any, clearText: boolean = false): string {
    try {
        if (clearText) text = text.replace(/[\[,\]}{"`'*()]/gi, "");
        if (text.length > value && value !== false) return `${text.substring(0, value)}...`;
        return text;
    } catch { return text; }
}