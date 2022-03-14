import {FullTimeSongs} from "../../../Manager/Functions/FullTimeSongs";
import {Song} from "../../../Manager/Queue/Structures/Song";
import {Queue} from "../../../Manager/Queue/Structures/Queue";
import {EmbedConstructor, wClient} from "../../../../../../Core/Utils/TypesHelper";
import {NotFound, NotImage, NotVer, Ver} from "./Helper";

/**
 * @description Embed сообщение о добавленном треке
 * @param client {wClient} Клиент
 * @param color {Song<color>} Цвет
 * @param author {Song<author>} Автор трека
 * @param image {Song<image>} Картинка трека
 * @param title {Song<title>} Название трека
 * @param url {Song<url>} Ссылка на трек
 * @param duration {Song<duration>} Длительность трека
 * @param requester {Song<requester>} Кто включил трек
 * @param songs {Queue<songs>} Все треки
 * @param err {Error} Ошибка выданная плеером
 */
export async function Warning(client: wClient, {color, author, image, title, url, duration, requester}: Song, {songs}: Queue, err: Error): Promise<EmbedConstructor> {
    return {
        color,
        description: `\n[${title}](${url})\n\`\`\`js\n${err}...\`\`\``,
        author: {
            name: client.ConvertedText(author.title, 45, false),
            iconURL: author.isVerified === undefined ? NotFound : author.isVerified ? Ver : NotVer,
            url: author.url,
        },
        thumbnail: {
            url: image?.url ?? NotImage,
        },
        timestamp: new Date(),
        footer: {
            text: `${requester.username} | ${FullTimeSongs(songs)} | 🎶: ${songs.length}`,
            iconURL: requester.displayAvatarURL() ? requester.displayAvatarURL() : client.user.displayAvatarURL(),
        }
    }
}