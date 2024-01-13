import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {toError} from "@Client/Audio";
import {Event} from "@Client";
import {db} from "@src";

export default class Player_toError extends Event<any> {
    public constructor() {
        super({
            name: "error",
            type: "player",
            //@ts-ignore
            execute: (queue: ArrayQueue, err: string, crash: boolean) => {
                //Выводим сообщение об ошибке
                toError(queue, err);

                //Если возникает критическая ошибка
                if (crash) return db.music.queue.remove(queue.guild.id);

                queue.songs.shift();
                setTimeout(() => queue.player.play(queue.songs.song.resource), 5e3);
            }
        });
    }
}