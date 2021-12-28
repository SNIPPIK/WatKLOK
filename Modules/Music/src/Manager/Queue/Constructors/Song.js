"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Song = void 0;
const ParserTimeSong_1 = require("../../Functions/ParserTimeSong");
const Colors = __importStar(require("../../../../../../db/YTDL.json"));
class Song {
    constructor(track, message) {
        this.ConstThumbnails = ({ thumbnails }) => thumbnails && thumbnails.url ? thumbnails : { url: "not" };
        this.Color = (type) => {
            try {
                return Colors.colors[type.toUpperCase()];
            }
            catch (e) {
                return "#03f0fc";
            }
        };
        this.Type = (url) => {
            try {
                let start = url.split('://')[1].split('/')[0];
                let split = start.split(".");
                return (split[split.length - 2]).toUpperCase();
            }
            catch (e) {
                return "UNKNOWN";
            }
        };
        let type = this.Type(track.url);
        this.id = track.id;
        this.title = track.title;
        this.url = track.url;
        this.author = Song.ConstAuthor(track);
        this.duration = Song.ConstDuration(track);
        this.thumbnails = this.ConstThumbnails(track);
        this.requester = message.author;
        this.isLive = track.isLive;
        this.color = this.Color(type);
        this.type = type;
        this.format = track.format;
    }
    static ConstDuration({ duration }) {
        return {
            seconds: parseInt(duration.seconds),
            StringTime: parseInt(duration.seconds) > 0 ? (0, ParserTimeSong_1.ParserTimeSong)(parseInt(duration.seconds)) : 'Live'
        };
    }
    static ConstAuthor({ author }) {
        return {
            id: author.id,
            url: author.url,
            title: author.title,
            thumbnails: author.thumbnails && author.thumbnails.url ? author.thumbnails : { url: "not" },
            isVerified: author.isVerified
        };
    }
}
exports.Song = Song;
