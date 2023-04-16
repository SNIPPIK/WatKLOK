import { ClientMessage, EmbedConstructor } from "@Client/Message";
import { DurationUtils } from "@Utils/Durations";
import { Platform } from "../../Platform";
import { Music } from "@db/Config.json";
import { ISong, Song } from "../Song";
import { Colors } from "discord.js";
import { WatKLOK } from "@Client";
import { Queue } from "../Queue";

//Здесь хранятся все EMBED данные о сообщениях (Используется в Managers/Player/Messages)
export namespace EmbedMessages {
    /**
    * @description JSON<EMBED> для отображения текущего трека
    * @param client {WatKLOK} Клиент
    * @param queue {Queue} Очередь
    */
    export function toPlaying(queue: Queue): EmbedConstructor {
        const { color, author, image, requester } = queue.song;
        const fields = getFields(queue);
        const AuthorSong = replaceText(author.title, 45, false);

        return {
            color, image: image.track, thumbnail: image.author, fields,
            author: { name: AuthorSong, url: author.url, iconURL: Music.note },
            footer: { text: `${requester.username} | ${DurationUtils.getTimeQueue(queue)} | 🎶: ${queue.songs.length}`, iconURL: requester.avatarURL() }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description JSON<EMBED> для отображения добавленного трека
     * @param client {WatKLOK} Клиент
     * @param color {Song<color>} Цвет
     * @param song {Song} Трек который был добавлен
     * @param songs {Queue<songs>} Все треки
     */
    export function toPushSong(song: Song, { songs }: Queue): EmbedConstructor {
        const { color, author, image, title, url, duration, requester } = song;
        const AuthorSong = replaceText(author.title, 45, false);
        const fields = [{ name: "**Добавлено в очередь**", value: `**❯** **[${replaceText(title, 40, true)}](${url}})\n**❯** \`\`[${duration.full}]\`\`**` }];

        return {
            color, fields, thumbnail: image.track,
            author: { name: AuthorSong, iconURL: image.author.url, url: author.url },
            footer: { text: `${requester.username} | ${DurationUtils.getTimeQueue(songs)} | 🎶: ${songs.length}`, iconURL: requester.avatarURL() }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description JSON<EMBED> для отображения данных плейлиста
     * @param client {WatKLOK} Бот
     * @param DisAuthor {ClientMessage.author} Автор сообщения
     * @param playlist {ISong.playlist} Плейлист
     * @param author {ISong.author} Автор плейлиста
     */
    export function toPushPlaylist({ author: DisAuthor }: ClientMessage, playlist: ISong.playlist): EmbedConstructor {
        const { author, image, url, title, items } = playlist;

        return {
            color: Colors.Blue, timestamp: new Date(),
            author: { name: author?.title, url: author?.url },
            thumbnail: { url: author?.image?.url ?? Music.note },
            image: typeof image === "string" ? { url: image } : image ?? { url: Music.note },
            fields: [{ name: `**Найден плейлист**`, value: `**❯** **[${title}](${url})**\n**❯** **Всего треков: ${playlist.items.length}**` }],
            footer: { text: `${DisAuthor.username} | ${DurationUtils.getTimeQueue(items)} | 🎶: ${items?.length}`, iconURL: DisAuthor.displayAvatarURL({}) }
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
    export function toError(client: WatKLOK, { songs, song }: Queue, err: Error | string): EmbedConstructor {
        const { color, author, image, title, url, requester } = song;
        const AuthorSong = replaceText(author.title, 45, false);

        return {
            color, thumbnail: image.track, timestamp: new Date(),
            description: `\n[${title}](${url})\n\`\`\`js\n${err}...\`\`\``,
            author: { name: AuthorSong, url: author.url, iconURL: image.author.url },
            footer: { text: `${requester.username} | ${DurationUtils.getTimeQueue(songs)} | 🎶: ${songs.length}`, iconURL: requester?.avatarURL() ?? client.user.displayAvatarURL() }
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description JSON<Embed> для отображения найденных треков
     * @param tracks {inTracks[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param author {message.author} Автор запроса
     */
    export function toSearch(tracks: ISong.track[], platform: string, author: ClientMessage["author"]): EmbedConstructor {
        return {
            color: Platform.color(platform as any),
            title: `Найдено ${tracks.length}`,
            footer: { text: `${author.username} | Платформа: ${platform}`, iconURL: author.avatarURL() },
            timestamp: new Date(),

            fields: tracks.map((track, index) => {
                const duration = platform === "YOUTUBE" ? track.duration.seconds : DurationUtils.ParsingTimeToString(parseInt(track.duration.seconds));
                const title = `[${replaceText(track.title, 80, true)}](${track.url})`; //Название трека
                const author = `${replaceText(track.author.title, 30, true)}`; //Автор трека

                index++;

                return {
                    name: `${index}: _${author} | ${duration ?? "LIVE"}_`,
                    value: `__**❯** ${title}__\n`
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
 * @param client {WatKLOK} Клиент
 */
function getFields(queue: Queue): EmbedConstructor["fields"] {
    const { songs, song, player } = queue;
    const VisualDuration = toString(song.duration, player.streamDuration);

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
    if (duration.full === "Live" || !Music.ProgressBar.enable) return `\`\`[${duration}]\`\``;

    const parsedDuration = DurationUtils.ParsingTimeToString(playDuration);
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
        const progressText = Music.ProgressBar.full.repeat(progressSize);
        const emptyText = Music.ProgressBar.empty.repeat(size - progressSize);

        return `${progressText}${Music.ProgressBar.button}${emptyText}`;
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
        if (clearText) text = text.replace(/[\[,\]}{"`'*]()/gi, "");
        if (text.length > value && value !== false) return `${text.substring(0, value)}...`;
        return text;
    } catch { return text; }
}