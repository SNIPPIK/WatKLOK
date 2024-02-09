import {AudioPlayer} from "@watklok/player/AudioPlayer";
import {ArrayQueue} from "@watklok/player/queue/Queue";
import {History} from "@watklok/player/utils/History";
import {PlayerEvent} from "@handler";
import {Logger} from "@Client";
import {db} from "@Client/db";

export default class extends PlayerEvent {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            execute: (queue: ArrayQueue, _: AudioPlayer, seek: number) => {
                if (seek !== 0) return;

                db.queue.events.emit("message/playing", queue, seek);
                //История треков сервера
                try {
                    if (History.enable && queue.songs.song.platform !== "DISCORD") new History(queue.songs.song, queue.guild.id);
                } catch (e) {
                    Logger.log("ERROR", e);
                }
            }
        });
    }
};