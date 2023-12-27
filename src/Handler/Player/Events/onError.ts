import {ArrayQueue} from "@components/AudioClient/Queue/Queue";
import toError from "@handler/Player/Messages/toError";
import {db} from "@components/QuickDB";

export default class {
    public readonly name = "error";
    public readonly execute = (queue: ArrayQueue, err: string, crash: boolean) => {
        //Выводим сообщение об ошибке
        toError(queue, err);

        //Если возникает критическая ошибка
        if (crash) return db.music.queue.remove(queue.guild.id);

        queue.songs.shift();
        setTimeout(() => queue.player.play(queue.songs.song?.resource, !queue.songs.song?.options?.isLive), 5e3);
    }
}