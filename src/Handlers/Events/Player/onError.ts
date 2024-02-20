import {Assign, Event} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (queue, _, err, crash = false) => {
                //Выводим сообщение об ошибке
                db.queue.events.emit("message/error", queue, err);

                //Если возникает критическая ошибка
                if (crash) return db.queue.remove(queue.guild.id);

                queue.songs.shift();
                //Включаем трек через время
                setTimeout(() => queue.player.play(queue.songs.song), 5e3);
            }
        });
    }
}