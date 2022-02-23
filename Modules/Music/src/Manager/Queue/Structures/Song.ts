import {ParserTimeSong} from "../../Functions/ParserTimeSong";
import {User} from "discord.js";
import {
    FFmpegFormat,
    InputFormat,
    InputTrack, InputTrackAuthor,
    InputTrackDuration, InputTrackImage,
    wMessage
} from "../../../../../../Core/Utils/TypesHelper";
import {Colors} from "../../../../../../Core/Utils/Colors";

type SongType = "SPOTIFY" | "YOUTUBE" | "VK" | "UNKNOWN";

export class Song {
    public id: string | number;
    public title: string;
    public url: string;
    public author: InputTrackAuthor;
    public duration: {
        seconds: number,
        StringTime: string
    };
    public image: InputTrackImage;
    public requester: User;
    public isLive: boolean;
    public color: number;
    public type: SongType;
    public format: FFmpegFormat;

    public constructor(track: InputTrack, {author}: wMessage) {
        const type = Song.Type(track.url);

        this.id = track.id;
        this.title = track.title;
        this.url = track.url;
        this.author = track.author;
        this.duration = Song.ConstDuration(track.duration);
        this.image = track.image;
        this.requester = author;
        this.isLive = track.isLive;
        this.color = Song.Color(type);
        this.type = type;
        this.format = ConstFormat(track.format);
    };
    protected static ConstDuration = (duration: InputTrackDuration): { StringTime: string | "Live"; seconds: number } => {
        const seconds = parseInt(duration.seconds);
        return {
            seconds, StringTime: seconds > 0 ? ParserTimeSong(seconds) : 'Live'
        };
    };
    protected static Color = (type: string): number => type === "YOUTUBE" ? Colors.RED : type === "SPOTIFY" ? Colors.GREEN : Colors.BLUE;
    protected static Type = (url: string): SongType => {
        try {
            let start = url.split('://')[1].split('/')[0];
            let split = start.split(".");
            return (split[split.length - 2]).toUpperCase() as SongType;
        } catch {
            return "UNKNOWN";
        }
    };
}

export function ConstFormat (format: InputFormat): null | FFmpegFormat {
    if (!format) return null;

    return {
        url: format.url,
        // @ts-ignore
        work: format?.work
    };
}