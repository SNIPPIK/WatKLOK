"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.all = exports.YouTube = exports.Spotify = exports.setFFmpeg = void 0;
const Track_1 = require("./_ParserPlatform/all/_pages/Track");
const Video_1 = require("./_ParserPlatform/youtube/_pages/Video");
const Playlist_1 = require("./_ParserPlatform/youtube/_pages/Playlist");
const Search_1 = require("./_ParserPlatform/youtube/_pages/Search");
const Utils_1 = require("./_ParserPlatform/youtube/Utils");
const SpotifyApi_1 = __importDefault(require("./_ParserPlatform/SpotifyApi"));
const setFFmpeg = (path) => process.env.FFmpeg = String(path);
exports.setFFmpeg = setFFmpeg;
class Spotify {
    constructor() {
        this.getTrack = new SpotifyApi_1.default().getTrack;
        this.getPlaylist = new SpotifyApi_1.default().getPlaylistTracks;
        this.Settings = new SpotifyApi_1.default().Settings;
    }
}
exports.Spotify = Spotify;
class YouTube {
    constructor() {
        this.getVideo = async (url) => (0, Video_1.getVideoInfo)(url).then(async ({ VideoData, LiveData, format }) => {
            if (!VideoData)
                return null;
            return { ...VideoData, format: await new Utils_1.Utils()._FindOpusFormat(format, VideoData.isLive) ?? { url: LiveData.LiveUrl, other: 'm3u8' } };
        }).catch(() => null);
        this.getPlaylist = new Playlist_1.ParsePlaylistPage().run;
        this.searchVideos = new Search_1.SearchVideo().FindVideo;
        this.setCookie = (cookie) => process.env.YTcookie = `${cookie}`;
    }
}
exports.YouTube = YouTube;
class all {
    constructor() {
        this.getTrack = new Track_1._parseAllTrack().run;
    }
}
exports.all = all;
