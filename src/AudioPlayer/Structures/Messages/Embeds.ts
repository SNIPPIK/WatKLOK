import { ClientMessage, EmbedConstructor } from "@Client/interactionCreate";
import { replacer } from "@Handler/FileSystem/Handle/Command";
import { DurationUtils } from "@Structures/Durations";
import { Platform } from "@Structures/Platform";
import { ISong, Song } from "@Queue/Song";
import { WatKLOK } from "@Client/Client";
import { Music } from "@db/Config.json";
import { Queue } from "@Queue/Queue";
import { Colors } from "discord.js";

export { EmbedMessages };
//====================== ====================== ====================== ======================


//Здесь хранятся все EMBED данные о сообщениях (Используется в Managers/Player/Messages)
namespace EmbedMessages {
    /**
    * @description JSON<EMBED> для отображения текущего трека
    * @param client {WatKLOK} Клиент
    * @param queue {Queue} Очередь
    */
    export function toPlaying(queue: Queue): EmbedConstructor {
        const { color, author, image, requester } = queue.song;
        const fields = getFields(queue);
        const AuthorSong = replacer.replaceText(author.title, 45, false);

        return {
            color, image: image.track, thumbnail: image.author, fields,
            author: { name: AuthorSong, url: author.url, iconURL: choiceImage(author?.isVerified) },
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
        const AuthorSong = replacer.replaceText(author.title, 45, false);
        const fields = [{ name: "**Добавлено в очередь**", value: `**❯** **[${replacer.replaceText(title, 40, true)}](${url}})\n**❯** \`\`[${duration.full}]\`\`**` }];

        return {
            color, fields,
            thumbnail: image.track,
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
            author: { name: author?.title, iconURL: author?.image?.url, url: author?.url },
            thumbnail: typeof image === "string" ? { url: image } : image ?? { url: Music.images._image },
            description: `Найден плейлист **[${title}](${url})**`,
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
        const AuthorSong = replacer.replaceText(author.title, 45, false);

        return {
            color, thumbnail: image.track, timestamp: new Date(),
            description: `\n[${title}](${url})\n\`\`\`js\n${err}...\`\`\``,
            author: { name: AuthorSong, url: author.url, iconURL: choiceImage(author.isVerified) },
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
                const title = `[${replacer.replaceText(track.title, 80, true)}](${track.url})`; //Название трека
                const author = `${replacer.replaceText(track.author.title, 30, true)}`; //Автор трека

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
    const fields = [{ name: `**Сейчас играет**`, value: `**❯** **[${replacer.replaceText(song.title, 29, true)}](${song.url})**\n${VisualDuration}` }];

    //Следующий трек
    if (songs.length > 1) fields.push({ name: `**Следующий трек**`, value: `**❯** **[${replacer.replaceText(songs[1].title, 29, true)}](${songs[1].url})**` });
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
    const progress = matchBar(playDuration, duration.seconds, 20);
    const string = `**❯** \`\`[${parsedDuration} \\ ${duration.full}]\`\` \n\`\``;

    return `${string}${progress}\`\``;
}
//====================== ====================== ====================== ======================
/**
 * @description Вычисляем прогресс бар
 * @param currentTime {number} Текущие время
 * @param maxTime {number} Макс времени
 * @param size {number} Кол-во символов
 */
function matchBar(currentTime: number, maxTime: number, size: number = 15): string {
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
 * @description Выдаем иконку проверки автора музыки
 * @param isVer {boolean} Подтвержденный пользователь?
 */
function choiceImage(isVer: boolean): string {
    if (isVer === undefined) return Music.images._found;
    else if (isVer) return Music.images.ver;
    return Music.images._ver;
}