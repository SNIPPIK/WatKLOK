import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {MessagePlayer} from "@AudioPlayer/Message";
import {Queue} from "@AudioPlayer/Queue/Queue";
import {ClientMessage} from "@Client/Message";
import {Debug} from "@db/Config.json";
import {Collection} from "discord.js";
import {Voice} from "@Utils/Voice";
import {Logger} from "@Logger";

/**
 * @description Collection Queue, содержит в себе все очереди
 */
export class CollectionQueue extends Collection<string, Queue> {
    /**
     * @description Записываем очередь в this
     */
    private set queue(queue: Queue) {
        //Запускаем callback для проигрывания треков
        setImmediate(() => queue.play = 0);

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

        if (Debug) Logger.debug(`[Queue]: [${queue.guild.id}]: has create`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очереди или добавляем в нее объект или объекты
     */
    public set create(options: { message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist }) {
        const { message, VoiceChannel, info } = options;
        const queue = this.get(message.guild.id);

        if (!queue) {
            //Создаем очередь
            const GuildQueue = new Queue(message, VoiceChannel);

            //Подключаемся к голосовому каналу
            GuildQueue.player.connection = Voice.Join(VoiceChannel); //Добавляем подключение в плеер

            this.queue = GuildQueue;
        }

        //Добавляем плейлист или трек в очередь
        this.pushTracks = { queueID: message.guild.id, info };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем трек или плейлист
     */
    private set pushTracks(options: { queueID: string, info: ISong.track | ISong.playlist }) {
        const queue = this.get(options.queueID);
        const info = options.info;
        const { message } = queue;
        const requester = message.author;

        //Загружаем плейлисты или альбомы
        if ("items" in info && info.items.length > 1) {
            //Отправляем сообщение о том что плейлист будет добавлен в очередь
            MessagePlayer.toPushPlaylist(message, info);

            //Загружаем треки из плейлиста в очередь
            for (let track of info.items) queue.songs.push(new Song(track, requester));
            return;
        }

        //Добавляем трек в очередь
        // @ts-ignore
        const song = new Song(info ?? info?.items[0], requester);
        if (queue.songs.length >= 1) MessagePlayer.toPushSong(queue, song);

        queue.songs.push(song);
    };
}