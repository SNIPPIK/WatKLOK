import {History} from "@lib/voice/player/utils/History";
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

                if (History.enable && queue.songs.song.platform !== "DISCORD") new History(queue.songs.song, queue.guild.id);
            }
        });
    }
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
                if (!queue?.songs?.song) return db.audio.queue.remove(queue.guild.id);

                //Проверяем надо ли удалить из очереди трек
                const removedSong = queue.repeat === "off" || queue.repeat === "songs" ? queue.songs.shift() : null;
                if (removedSong && (queue.repeat === "songs" || queue.radio)) queue.songs.push(removedSong);

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
                if (!queue.player) return;

                switch (crash) {
                    //Если возникает критическая ошибка
                    case "crash": {
                        db.audio.queue.remove(queue.guild.id);

                        //Выводим сообщение об ошибке
                        return db.audio.queue.events.emit("message/error", queue, err);
                    }

                    //Если надо пропустить трек из-за ошибки
                    case "skip": {
                        //Если трек не играет, то пропускаем его
                        if (!queue.player.playing) {
                            if (queue.songs.size > 1) queue.songs.splice(0, 1);
                            else queue.songs.shift();

                            //Включаем трек через время
                            setTimeout(() => queue.player.play(queue.songs.song), 5e3);
                        }

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