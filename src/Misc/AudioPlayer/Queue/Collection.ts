import {Collection, StageChannel, VoiceChannel} from "discord.js";
import {ClientMessage} from "@Client/Message";
import {PlayerMessage} from "../Message";
import {ISong, Song} from "./Song";
import {Voice} from "@Util/Voice";
import {Logger} from "@Logger";
import {Queue} from "./Queue";
import {env} from "@env";

const PlayerTimeout = parseInt(env.get("music.player.timeout"));

export class CollectionQueue extends Collection<string, Queue> {
    /**
     * @description Создаем очереди или добавляем в нее объект или объекты
     * @param options {message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist} Параметры для создания очереди
     */
    public set push(options: { message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, info: ISong.track | ISong.playlist }) {
        const { message, VoiceChannel, info } = options;
        const queue = this.get(message.guild.id);

        //Если нет очереди, то создаём
        if (!queue) this.addQueue = new Queue(message, VoiceChannel);

        //Добавляем плейлист или трек в очередь
        this.addTracks = { queueID: message.guild.id, info, author: message.author };
    };


    /**
     * @description Добавляем трек или плейлист
     * @param options {queueID: string, info: ISong.track | ISong.playlist} Параметры для добавления в очередь
     */
    private set addTracks(options: { queueID: string, info: ISong.track | ISong.playlist, author: ClientMessage["author"] }) {
        const {queueID, info, author} = options;
        const queue = this.get(queueID);

        if ("duration" in info) {
            queue.songs.push(new Song(info, author));

            if (queue.songs.length > 1) PlayerMessage.toPush(queue);
        } else {
            if (info.items.length > 1) {
                //Отправляем сообщение о том что плейлист будет добавлен в очередь
                PlayerMessage.toPushPlaylist(queue.message, info);

                //Загружаем треки из плейлиста в очередь
                for (let track of info.items) queue.songs.push(new Song(track, author));
                return;
            }
            queue.songs.push(new Song(info?.items[0], author));
            if (queue.songs.length > 1) PlayerMessage.toPush(queue);
        }
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
                //Определяем тип loop
                if (queue?.songs) {
                    const {loop} = queue.options;

                    //Если не включен режим радио, или повтор не song
                    if (loop === "off" || loop === "songs") {
                        //Убираем текущий трек
                        const shiftSong = queue.songs.shift();

                        //Если тип повтора треки, то добавляем по новой трек
                        if (loop === "songs") queue.songs.push(shiftSong);
                    }
                }

                //Выбираем случайный номер трека, просто меняем их местами
                if (queue?.options?.random) queue.swap = Math.floor(Math.random() * queue.songs.length);

                //Включаем трек
                setTimeout(() => queue.play = 0, PlayerTimeout * 1e3);
            })

            //Если в плеере возникнет ошибка
            .on("error", (err, skip) => {
                //Выводим сообщение об ошибке
                PlayerMessage.toError(queue, err);

                //Если пропускаем трек
                if (skip) {
                    queue.songs.shift();
                    setTimeout(() => queue.play = 0, 5e3);
                    return;
                }

                //Если возникает критическая ошибка
                queue.emit("destroy");
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
                if (queue.player) {
                    queue.player.removeAllListeners();
                    //Выключаем плеер если сейчас играет трек
                    queue.player.stop;

                    //Удаляем ненужные данные
                    queue.player.cleanup();
                }

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