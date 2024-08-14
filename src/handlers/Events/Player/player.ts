import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";
import {env} from "@env";

const timeout = parseInt(env.get("player.timeout"));

/**
 * @class onEnd
 * @event player/ended
 * @description Завершение проигрывания трека
 */
class onEnd extends Constructor.Assign<Handler.Event<"player/ended">> {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            execute: (queue, _, seek) => {
                if (seek !== 0) return;
                db.audio.queue.events.emit("message/playing", queue);

                // Кешируем проигранный трек
                if (db.cache.history) {
                    if (queue.songs.song.platform !== "DISCORD") return;
                    new db.cache.history(queue.songs.song, queue.guild.id);
                }
            }
        });
    };
}

/**
 * @class onWait
 * @event player/wait
 * @description Плеер ожидает действий
 */
class onWait extends Constructor.Assign<Handler.Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (queue) => {
                //Если нет треков в очереди
                if (!queue?.songs?.song || !queue.player) return db.audio.queue.remove(queue.guild.id);

                // Последний трек
                //if (queue.songs.size === 1) db.audio.queue.events.emit("message/last", queue.songs.song, queue.message);

                //Проверяем надо ли удалить из очереди трек
                const removedSong = queue.repeat === "off" || queue.repeat === "songs" ? queue.songs.shift() : null;
                if (removedSong && queue.repeat === "songs") queue.songs.push(removedSong);

                //Проверяем надо ли перетасовывать очередь
                if (queue.shuffle && queue.repeat === "off") {
                    for (let i = queue.songs.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
                    }
                }

                //Включаем трек через время
                setTimeout(() => queue.player.play(queue.songs.song), timeout);
            }
        });
    }
}

/**
 * @class onError
 * @event player/error
 * @description Плеер словил ошибку
 */
class onError extends Constructor.Assign<Handler.Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (queue, _, err, crash) => {
                //Если нет плеера, то нет смысла продолжать
                if (!queue || !queue.player || !queue.player.play) return;

                switch (crash) {
                    //Если надо пропустить трек из-за ошибки
                    case "skip": {
                        //Если есть треки в очереди
                        if (queue.songs.size > 0) {
                            queue.songs.shift();

                            //Включаем следующий трек через время
                            queue.player.play(queue.songs.song);
                        }

                        //Выводим сообщение об ошибке
                        return db.audio.queue.events.emit("message/error", queue, err);
                    }

                    //Если возникает критическая ошибка
                    case "crash": {
                        db.audio.queue.remove(queue.guild.id);

                        //Выводим сообщение об ошибке
                        return db.audio.queue.events.emit("message/error", queue, err);
                    }
                }
            }
        });
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onError, onWait, onEnd});