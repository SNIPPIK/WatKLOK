import {ArrayQueue} from "@components/AudioClient/Queue/Queue";
import {db} from "@components/QuickDB";
import {env} from "@env";

const timeout = parseInt(env.get("player.timeout"));
export default class {
    public readonly name = "wait";
    public readonly execute = (queue: ArrayQueue) => {
        const {loop} = queue.options;

        //Проверяем надо ли удалить из очереди трек
        const removedSong = loop === "off" || loop === "songs" ? queue.songs.shift() : null;
        if (removedSong && loop === "songs") queue.songs.push(removedSong);

        if (!queue?.songs?.song) return db.music.queue.remove(queue.guild.id);

        //Включаем трек через время
        setTimeout(() => {
            const isLive = !queue.songs.song?.options.isLive;

            queue.player.play(queue.songs.song?.resource, isLive);
        }, timeout);
    }
}