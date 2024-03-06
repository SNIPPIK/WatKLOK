import {History} from "@watklok/player/utils/History";
import {Constructor, Event} from "@handler";
import {db} from "@Client/db";
import {env} from "@env";
const timeout = parseInt(env.get("player.timeout"));

/**
 * @class onEnd
 * @event player/ended
 * @description Завершение проигрывания трека
 */
class onEnd extends Constructor.Assign<Event<"player/ended">> {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            execute: (queue, _, seek) => {
                if (seek !== 0) return;
                db.queue.events.emit("message/playing", queue);

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
class onWait extends Constructor.Assign<Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (queue) => {
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

                if (!queue?.songs?.song) return db.queue.remove(queue.guild.id);

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
class onError extends Constructor.Assign<Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (queue, _, err, crash) => {
                //Выводим сообщение об ошибке
                db.queue.events.emit("message/error", queue, err);

                //Если возникает критическая ошибка
                if (crash === "crash") return db.queue.remove(queue.guild.id);
                else if (crash === "skip") {
                    queue.songs.shift();

                    //Если нет плеер, то нет смысла продолжать
                    if (!queue.player) return;

                    //Включаем трек через время
                    setTimeout(() => queue.player.play(queue.songs.song), 5e3);
                }
            }
        });
    }
}

export default Object.values({onError, onWait, onEnd});