import {ISong, Song} from "@AudioPlayer/Queue/Song";
import {MessagePlayer} from "@AudioPlayer/Message";
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
     * @description Записываем очередь в this
     * @param queue {Queue} ОЧередь для сохранения
     */
    private set saveQueue(queue: Queue) {
        //Запускаем callback для проигрывания треков
        setImmediate(() => queue.play = 0);

        //Добавляем очередь в базу
        this.set(queue.guild.id, queue);

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
    //====================== ====================== ====================== ======================
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
     * @description Запускаем отслеживание окончания проигрывания
     * @param QueueID {string} ID сервера
     */
    public set onPlayerIdle(QueueID: string) {
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
            setTimeout(() => queue.play = 0, 1500);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запускаем отслеживание ошибок в плеере
     * @param QueueID {string} ID сервера
     */
    public set onPlayerError(QueueID: string) {
        const queue = this.get(QueueID);

        //Если в плеере возникнет ошибка
        queue.player.on("error", (err, isSkip) => {
            //Выводим сообщение об ошибке
            MessagePlayer.toError(queue, err);

            setTimeout((): void => {
                if (isSkip) {
                    queue.songs.shift();
                    setTimeout(() => queue.play = 0, 1e3);
                }
            }, 1200);
        });
    };
}