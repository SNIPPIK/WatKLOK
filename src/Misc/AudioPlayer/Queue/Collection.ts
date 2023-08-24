import {StageChannel, VoiceChannel} from "discord.js";
import {ClientMessage} from "@Client/Message";
import {PlayerMessage} from "../Message";
import {ISong, Song} from "./Song";
import {Voice} from "@Util/Voice";
import {Logger} from "@Logger";
import {Queue} from "./Queue";
import {env} from "@env";

const PlayerTimeout = parseInt(env.get("music.player.timeout"));

export class CollectionQueue extends Map<string, Queue> {
    /**
     * @description Создаем очереди или добавляем в нее объект или объекты
     * @param options {message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist} Параметры для создания очереди
     */
    public set push(options: { message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, info: ISong.track | ISong.playlist | ISong.track[], platform?: string }) {
        const { message, VoiceChannel, info } = options;

        //Для поиска не нужно создавать очередь
        if (info instanceof Array) {
            PlayerMessage.toSearch(info, options.platform, message);
            return;
        }

        //Если нет очереди, то создаём
        const queue = this.get(message.guild.id);
        if (!queue) this.addQueue = new Queue(message, VoiceChannel);

        //1 трек
        if ("duration" in info) {
            this.addTrack = {queueID: message.guild.id, info: info, author: message.author};
            return;
        }
        //Плейлист или альбом
        else if ("items" in info) {
            if (info.items.length === 1) this.addTrack = {queueID: message.guild.id, info: info.items.at(0), author: message.author};
            else this.addTracks = { queueID: message.guild.id, info, author: message.author };
        }
    };


    /**
     * @description Добавляем трек в очередь
     * @param options {queueID: string, info: ISong.track | ISong.playlist} Параметры для добавления в очередь
     */
    private set addTrack(options: { queueID: string, info: ISong.track, author: ClientMessage["author"] }) {
        const {queueID, info, author} = options;
        const queue = this.get(queueID);

        queue.songs.push(new Song(info, author));

        //Если это не первый трек, то отправляем сообщение о том что было добавлено
        if (queue.songs.length > 1) PlayerMessage.toPush(queue);
    };

    /**
     * @description Добавляем плейлист в очередь
     * @param options {queueID: string, info: ISong.track | ISong.playlist} Параметры для добавления в очередь
     */
    private set addTracks(options: { queueID: string, info: ISong.playlist, author: ClientMessage["author"] }) {
        const {queueID, info, author} = options;
        const queue = this.get(queueID);

        //Отправляем сообщение о том что плейлист будет добавлен в очередь
        PlayerMessage.toPushPlaylist(queue.message, info);

        //Загружаем треки из плейлиста в очередь
        for (let track of info.items) queue.songs.push(new Song(track, author));
    };


    /**
     * @description Добавляем очередь в Collection
     * @param queue {Queue} Очередь которую добавляем
     */
    private set addQueue(queue: Queue) {
        setImmediate(() => {
            //Запускаем отслеживание плеера
            this.onPlayerEvents = queue.guild.id;

            //Запускаем отслеживание очереди
            this.onQueueEvents = queue.guild.id;

            //Запускаем музыку
            queue.play = 0;
        });

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

        if (env.get("debug.player")) Logger.debug(`Queue: create for [${queue.guild.id}]`);
    };


    /**
     * @description Запускаем отслеживание ошибок в плеере
     * @param QueueID {string} ID сервера
     */
    private set onPlayerEvents(QueueID: string) {
        const queue = this.get(QueueID);

       queue.player
            //Что будет делать плеер если закончит играть
            .on("idle", () => {
                if (queue?.songs) {
                    const {loop, random} = queue.options;

                    //Убираем текущий трек
                    const removedSong = loop === "off" || loop === "songs" ? queue.songs.shift() : null;
                    if (removedSong) {
                        if (loop === "songs") queue.songs.push(removedSong);
                    }

                    //Выбираем случайный номер трека, просто меняем их местами
                    if (random) queue.swap = Math.floor(Math.random() * queue.songs.length);
                }

                //Включаем трек через timeout
                setTimeout(() => queue.play = 0, PlayerTimeout * 1e3);
            })

            //Если в плеере возникнет ошибка
            .on("error", (err, crash): void => {
                //Выводим сообщение об ошибке
                PlayerMessage.toError(queue, err);

                //Если возникает критическая ошибка
                if (crash) { queue.emit("destroy"); return; }

                queue.songs.shift();
                setTimeout(() => queue.play = 0, 5e3);
            });
    };


    /**
     * @description Ивенты очереди
     * @param QueueID {string} ID сервера
     */
    private set onQueueEvents(QueueID: string) {
        const queue = this.get(QueueID);

        queue
            //Если очередь надо удалить
            .once("destroy", () => {
                //Чистим плеер
                if (queue.player) queue.player.cleanup();

                if (env.get("music.leave")) Voice.disconnect(queue.guild.id);
                if (env.get("debug.player")) Logger.debug(`Queue: deleted for [${queue.guild.id}]`);

                //Удаляем таймер из очереди
                queue.state = "destroy";

                //Удаляем сообщение
                queue.message = null;

                queue.removeAllListeners();
                this.delete(QueueID);
            })

            //Если начато удаление через время
            .on("start", () => {
                Voice.disconnect(queue.guild);
                queue.player.pause;
            })

            //Если удаление через время отклонено
            .on("cancel", () => queue.player.resume);
    };
}
