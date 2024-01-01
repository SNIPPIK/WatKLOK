import {ArrayQueue} from "@Client/Audio/Queue/Queue";
import {History} from "@Client/Audio/Stream/History";
import toPlay from "@handler/Player/Messages/toPlay";
import {Logger} from "@env";
export default class {
    public readonly name = "onStart";
    public readonly execute = (queue: ArrayQueue, seek: number) => {
        if (seek !== 0) return;

        toPlay(queue);
        //История треков сервера
        try {
            if (History.enable && queue.songs.song.platform !== "DISCORD") new History(queue.songs.song, queue.guild.id, queue.songs.song.platform);
        } catch (e) {
            Logger.error(e);
        }
    };
};