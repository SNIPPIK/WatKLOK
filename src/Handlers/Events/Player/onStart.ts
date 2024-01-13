import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {History} from "@Client/Audio/Player/History";
import {toPlay} from "@Client/Audio";
import {Event} from "@Client";
import {Logger} from "@src";

export default class Player_onStart extends Event<any> {
    public constructor() {
        super({
            name: "onStart",
            type: "player",
            // @ts-ignore
            execute: (queue: ArrayQueue, seek: number) => {
                if (seek !== 0) return;

                toPlay(queue);
                //История треков сервера
                try {
                    if (History.enable && queue.songs.song.platform !== "DISCORD") new History(queue.songs.song, queue.guild.id, queue.songs.song.platform);
                } catch (e) {
                    Logger.error(e);
                }
            }
        });
    }
};