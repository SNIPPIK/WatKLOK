import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {getPlayerMessage} from "@Client/Audio";
import {ActionMessage, Event} from "@handler";
import {db} from "@Client/db";

export default class Player_toError extends Event<any> {
    public constructor() {
        super({
            name: "error",
            type: "player",
            //@ts-ignore
            execute: (queue: ArrayQueue, err: string, crash: boolean) => {
                //Выводим сообщение об ошибке
                new ActionMessage(getPlayerMessage<"error">("error", [queue, err]));

                //Если возникает критическая ошибка
                if (crash) return db.music.queue.remove(queue.guild.id);

                queue.songs.shift();
                setTimeout(() => queue.player.play(queue.songs.song.resource), 5e3);
            }
        });
    }
}