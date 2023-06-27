import {Collection, StageChannel, VoiceChannel} from "discord.js";

//AudioPlayer
import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {PlayerMessage} from "@AudioPlayer/Message";
import {Queue} from "@AudioPlayer/Queue/Queue";

//Client
import {ClientMessage} from "@Client/Message";
import {env} from "@Client/Fs";

//Utils
import {Voice} from "@Utils/Voice";
import {Logger} from "@Utils/Logger";


const PlayerTimeout = parseInt(env.get("music.player.timeout"));

/**
 * @description Collection Queue, содержит в себе все очереди
 */
export class CollectionQueue extends Collection<string, Queue> {
    /**
     * @description Создаем очереди или добавляем в нее объект или объекты
     * @param options {message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist} Параметры для создания очереди
     */
    public set create(options: { message: ClientMessage, VoiceChannel: VoiceChannel | StageChannel, info: ISong.track | ISong.playlist }) {
        const { message, VoiceChannel, info } = options;
        const queue = this.get(message.guild.id);

        if (!queue) {
            //Создаем очередь
            const GuildQueue = new Queue(message, VoiceChannel);

            //Подключаемся к голосовому каналу
            GuildQueue.player.connection = Voice.join(VoiceChannel); //Добавляем подключение в плеер

            this.saveQueue = GuildQueue;
        }

        //Добавляем плейлист или трек в очередь
        this.pushTracks = { queueID: message.guild.id, info, author: message.author };
    };


    /**
     * @description Добавляем трек или плейлист
     * @param options {queueID: string, info: ISong.track | ISong.playlist} Параметры для добавления в очередь
     */
    private set pushTracks(options: { queueID: string, info: ISong.track | ISong.playlist, author: ClientMessage["author"] }) {
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
     * @description Записываем очередь в this
     * @param queue {Queue} Очередь для сохранения
     */
    private set saveQueue(queue: Queue) {
        //Запускаем callback для проигрывания треков
        setImmediate(() => queue.play = 0);

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

        //Запускаем отслеживание ивентов плеера
        this.onPlayerIdle = queue.guild.id;
        this.onPlayerError = queue.guild.id;

        //Запускаем отслеживание ивентов очереди
        this.onQueueEvents = queue.guild.id;

        if (env.get("debug.player")) Logger.debug(`Queue: create for [${queue.guild.id}]`);
    };


    /**
     * @description Запускаем отслеживание окончания проигрывания
     * @param QueueID {string} ID сервера
     */
    private set onPlayerIdle(QueueID: string) {
        const queue = this.get(QueueID);

        //Что будет делать плеер если закончит играть
        queue.player.on("idle", () => {
            //Определяем тип loop
            if (queue?.songs) {
                const { loop } = queue.options;

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
        });
    };


    /**
     * @description Запускаем отслеживание ошибок в плеере
     * @param QueueID {string} ID сервера
     */
    private set onPlayerError(QueueID: string) {
        const queue = this.get(QueueID);

        //Если в плеере возникнет ошибка
        queue.player.on("error", (err, isSkip) => {
            //Выводим сообщение об ошибке
            PlayerMessage.toError(queue, err);

            if (isSkip) {
                queue.songs.shift();
                setTimeout(() => queue.play = 0, PlayerTimeout * 1e3);
            }
        });
    };


    /**
     * @description Ивенты очереди
     * @param QueueID {string} ID сервера
     */
    private set onQueueEvents(QueueID: string) {
        const queue = this.get(QueueID);

        //Если очередь надо удалить
        queue.once("destroy", () => {
            if (queue.player) {
                queue.player.removeAllListeners();

                //Выключаем плеер если сейчас играет трек
                queue.player.stop;

                //Удаляем текущий поток из-за ненадобности
                queue.player.stream = null;

                //Удаляем голосовое подключение
                queue.player.connection = null;
            }

            if (env.get("music.leave")) Voice.disconnect(queue.guild.id);
            if (env.get("debug.player")) Logger.debug(`Queue: deleted for [${queue.guild.id}]`);

            queue.state = "destroy";
            //Удаляем сообщение
            queue.message = null;

            this.delete(QueueID);
        });

        //Если начато удаление через время
        queue.on("start", () => {
            Voice.disconnect(queue.guild);
            queue.player.pause;
        });

        //Если удаление через время отклонено
        queue.on("cancel", () => queue.player.resume);
    };
}