import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {getPlayerMessage} from "@Client/Audio";
import {ActionMessage, Event} from "@handler";
import {db} from "@Client/db";

export default class extends Event<any> {
    public constructor() {
        super({
            name: "AudioPlayer_error",
            type: "player",
            //@ts-ignore
            execute: (queue: ArrayQueue, err: string, crash: boolean) => {
                //Выводим сообщение об ошибке
                new ActionMessage(getPlayerMessage<"error">("error", [queue, err]));

                //Если возникает критическая ошибка
                if (crash) return db.queue.remove(queue.guild.id);

                queue.songs.shift();
                setTimeout(() => queue.player.play(queue.songs.song), 5e3);
            }
        });
    }
}