import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {History} from "@Client/Audio/Player/History";
import {getPlayerMessage} from "@Client/Audio";
import {Logger} from "@Client";
import {ActionMessage, Event} from "@handler";

export default class extends Event<any> {
    public constructor() {
        super({
            name: "onStart",
            type: "player",
            // @ts-ignore
            execute: (queue: ArrayQueue, seek: number) => {
                if (seek !== 0) return;

                new ActionMessage(getPlayerMessage<"playing">("playing", [queue]))
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