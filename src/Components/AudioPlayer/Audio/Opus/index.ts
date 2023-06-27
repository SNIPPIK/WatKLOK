import {AudioFilters, Filters} from "@AudioPlayer/Audio/AudioFilters";
import {FFmpeg} from "../FFspace/FFmpeg";
import {OpusCompilation} from "./OpusCompilation";
import {Logger} from "@Utils/Logger";
import {env} from "@Client/Fs";

export class OpusAudio extends OpusCompilation {
    private readonly _ffmpeg: FFmpeg;

    public constructor(options: {path: string, filters: Filters, seek: number}) {
        super(options.seek, AudioFilters.getDuration(options?.filters));
        this._ffmpeg = new FFmpeg(options, { autoDestroy: true });
        this._ffmpeg.pipe(this.opus);

        ["end", "close", "error"].forEach((event) => this.opus.once(event, () => {
            this._ffmpeg.destroy();

            if (env.get("debug.ffmpeg")) Logger.debug(`AudioPlayer: FFmpeg emit event ${event}`);
        }));
    };
}