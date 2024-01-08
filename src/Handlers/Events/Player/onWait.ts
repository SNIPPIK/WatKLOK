import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {Event} from "@Client";
import {env} from "@env";
import {db} from "@src";

const timeout = parseInt(env.get("player.timeout"));
export default class Player_onWait extends Event<any> {
    public constructor() {
        super({
            name: "wait",
            type: "player",
            //@ts-ignore
            execute: (queue: ArrayQueue) => {
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
        });
    }
}