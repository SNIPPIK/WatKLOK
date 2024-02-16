import {Assign, Event} from "@handler";
import {db} from "@Client/db";
import {env} from "@env";

const timeout = parseInt(env.get("player.timeout"));
export default class extends Assign<Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (queue) => {
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