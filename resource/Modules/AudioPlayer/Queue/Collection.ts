import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {PlayerMessage} from "@AudioPlayer/Message";
import {Queue} from "@AudioPlayer/Queue/Queue";
import {ClientMessage} from "@Client/Message";
import {Collection, StageChannel, VoiceChannel} from "discord.js";
import {Voice} from "@Utils/Voice";
import {Logger} from "@Logger";
import {env} from "@env";

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
        this.pushTracks = { queueID: message.guild.id, info };
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Записываем очередь в this
     * @param queue {Queue} Очередь для сохранения
     */
    private set saveQueue(queue: Queue) {
        //Запускаем callback для проигрывания треков
        setImmediate(() => queue.play = 0);

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

        //Запускаем отслеживание ивентов
        this.onPlayerIdle = queue.guild.id;
        this.onPlayerError = queue.guild.id;
        this.onQueueEvents = queue.guild.id;

        if (env.get("debug.player")) Logger.debug(`[Queue]: [${queue.guild.id}]: has create`);
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Добавляем трек или плейлист
     * @param options {queueID: string, info: ISong.track | ISong.playlist} Параметры для добавления в очередь
     */
    private set pushTracks(options: { queueID: string, info: ISong.track | ISong.playlist }) {
        const queue = this.get(options.queueID);
        const info = options.info;
        const { message } = queue;
        const requester = message.author;

        if ("duration" in info) {
            queue.songs.push(new Song(info, requester));

            if (queue.songs.length > 1) PlayerMessage.toPush(queue);
        } else {
            if (info.items.length > 1) {
                //Отправляем сообщение о том что плейлист будет добавлен в очередь
                PlayerMessage.toPushPlaylist(message, info);

                //Загружаем треки из плейлиста в очередь
                for (let track of info.items) queue.songs.push(new Song(track, requester));
                return;
            }
            queue.songs.push(new Song(info?.items[0], requester));
            if (queue.songs.length > 1) PlayerMessage.toPush(queue);
        }
    };

    //====================== ====================== ====================== ======================

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
                const { radioMode, loop } = queue.options;

                //Если включен радио мод или тип повтора трек нечего не делаем
                if (radioMode || loop === "song") return;

                //Убираем текущий трек
                const shiftSong = queue.songs.shift();

                //Если тип повтора треки, то добавляем по новой трек
                if (loop === "songs") queue.songs.push(shiftSong);
            }

            //Выбираем случайный номер трека, просто меняем их местами
            if (queue?.options?.random) queue.swap = Math.floor(Math.random() * queue.songs.length);

            //Включаем трек
            setTimeout(() => queue.play = 0, 1800);
        });
    };

    //====================== ====================== ====================== ======================

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
                setTimeout(() => queue.play = 0, 1800);
            }
        });
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Ивенты очереди
     * @param QueueID {string} ID сервера
     */
    private set onQueueEvents(QueueID: string) {
        const queue = this.get(QueueID);

        //Если очередь надо удалить
        queue.once("destroy", () => {
            const message = queue.message;

            if (message && message?.deletable) message?.delete().catch(() => undefined);
            if (queue.player) {
                queue.player.destroy("stream");
                queue.player.destroy("all");
            }

            if (env.get("music.leave")) Voice.disconnect(queue.guild.id);
            if (env.get("debug.player")) Logger.debug(`[Queue]: [${queue.guild.id}]: has deleted`);

            queue.state = "destroy";
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