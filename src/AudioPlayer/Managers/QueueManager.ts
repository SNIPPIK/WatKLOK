import {MessagePlayer} from "@Managers/Players/Messages";
import {ClientMessage} from "@Client/interactionCreate";
import {inPlaylist, inTrack, Song} from "@Queue/Song";
import {Voice} from "@VoiceManager";
import {Queue} from "@Queue/Queue";

/**
 * @description Добавляем плейлист или трек в очередь
 * @param message {ClientMessage} Сообщение с сервера
 * @param VoiceChannel {Voice.VoiceChannels} К какому голосовому каналу надо подключатся
 * @param info {inTrack | inPlaylist} Входные данные это трек или плейлист?
 * @requires {CreateQueue}
 */
export function toQueue(message: ClientMessage, VoiceChannel: Voice.VoiceChannels, info: inTrack | inPlaylist): void {
    const {queue, status} = CreateQueue(message, VoiceChannel);
    const requester = message.author;

    setImmediate(() => {
        //Если поступает плейлист
        if ("items" in info) {
            MessagePlayer.toPushPlaylist(message, info);
            //Добавляем треки в очередь
            info.items.forEach((track: inTrack) => queue.push(new Song(track, requester)));
        } else queue.push(new Song(info, requester), queue.songs.length >= 1); //Добавляем трек в очередь

        //Запускаем callback плеера, если очередь была создана, а не загружена!
        if (status === "create") queue.play();
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем очереди или если она есть выдаем
 * @param message {ClientMessage} Сообщение с сервера
 * @param VoiceChannel {Voice.VoiceChannels} К какому голосовому каналу надо подключатся
 */
function CreateQueue(message: ClientMessage, VoiceChannel: Voice.VoiceChannels): { status: "create" | "load", queue: Queue } {
    const {client, guild} = message;
    const queue = client.queue.get(guild.id);

    if (queue) return {queue, status: "load"};

    //Создаем очередь
    const GuildQueue = new Queue(message, VoiceChannel);
     //Подключаемся к голосовому каналу
    GuildQueue.player.voice = Voice.Join(VoiceChannel); //Добавляем подключение в плеер
    client.queue.set(guild.id, GuildQueue); //Записываем очередь в <client.queue>

    return {queue: GuildQueue, status: "create"};
}