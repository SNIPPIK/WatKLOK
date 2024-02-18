import {History} from "@watklok/player/utils/History";
import {Assign, Event} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<Event<"player/ended">> {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            execute: (queue, _, seek) => {
                if (seek !== 0) return;
                db.queue.events.emit("message/playing", queue);

                if (History.enable && queue.songs.song.platform !== "DISCORD") new History(queue.songs.song, queue.guild.id);
            }
        });
    }
};