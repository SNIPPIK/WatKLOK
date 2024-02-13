import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Assign, PlayerEvent} from "@handler";
import {db} from "@Client/db";
import {env} from "@env";

const timeout = parseInt(env.get("player.timeout"));
export default class extends Assign<PlayerEvent> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (queue: ArrayQueue, _: AudioPlayer) => {
                //Проверяем надо ли удалить из очереди трек
                const removedSong = queue.loop === "off" || queue.loop === "songs" ? queue.songs.shift() : null;
                if (removedSong && queue.loop === "songs") queue.songs.push(removedSong);

                if (!queue?.songs?.song) return db.queue.remove(queue.guild.id);

                //Включаем трек через время
                setTimeout(() => queue.player.play(queue.songs.song), timeout);
            }
        });
    }
}