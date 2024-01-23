import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {Event} from "@handler";
import {db} from "@Client/db";
import {env} from "@env";

const timeout = parseInt(env.get("player.timeout"));
export default class Player_onWait extends Event<any> {
    public constructor() {
        super({
            name: "wait",
            type: "player",
            //@ts-ignore
            execute: (queue: ArrayQueue) => {
                //Проверяем надо ли удалить из очереди трек
                const removedSong = queue.loop === "off" || queue.loop === "songs" ? queue.songs.shift() : null;
                if (removedSong && queue.loop === "songs") queue.songs.push(removedSong);

                if (!queue?.songs?.song) return db.music.queue.remove(queue.guild.id);

                //Включаем трек через время
                setTimeout(() => {
                    queue.player.play(queue.songs.song);
                }, timeout);
            }
        });
    }
}