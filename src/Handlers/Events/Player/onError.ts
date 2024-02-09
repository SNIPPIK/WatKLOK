import {ArrayQueue} from "@watklok/player/queue/Queue";
import {PlayerEvent} from "@handler";
import {db} from "@Client/db";

export default class extends PlayerEvent {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (queue: ArrayQueue, err: string, crash: boolean) => {
                //Выводим сообщение об ошибке
                db.queue.events.emit("message/error", queue, err)

                //Если возникает критическая ошибка
                if (crash) return db.queue.remove(queue.guild.id);

                queue.songs.shift();
                setTimeout(() => queue.player.play(queue.songs.song), 5e3);
            }
        });
    }
}