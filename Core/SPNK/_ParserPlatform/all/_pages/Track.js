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
exports._parseAllTrack = void 0;
const youtube_dl_1 = require("../../../../../youtube-dl/youtube-dl");
const Utils_1 = require("../Utils");
const IconPlatform = __importStar(require("../../../../../db/YTDL.json"));
class _parseAllTrack {
    constructor() {
        this.run = async (url) => new youtube_dl_1.YouTubeDL().getMetadata([url]).then(async (video) => {
            if (!video)
                return { isValid: false };
            return {
                id: video.id,
                title: video.title || video.track,
                url: url,
                author: {
                    id: video.uploader_id || video.display_id,
                    title: video.uploader || video.artist,
                    thumbnails: { url: await this._Icon(await this.Type(url)).catch(() => null) }
                },
                duration: {
                    seconds: video.duration ? video.duration.toFixed(0) : 0
                },
                thumbnails: await this._Image(video.thumbnails),
                isLive: !!video.is_live,
                isValid: true,
                format: await new Utils_1.Utils()._FindFormat(video.formats)
            };
        });
        this._Image = async (icons) => icons.length >= 1 ? icons[icons.length - 1] : {};
        this._Icon = async (type) => IconPlatform.Icons[type];
        this.Type = async (url) => {
            try {
                let start = url.split('://')[1].split('/')[0];
                let split = start.split(".");
                return (split[split.length - 2]).toUpperCase();
            }
            catch (e) {
                return "UNKNOWN";
            }
        };
    }
}
exports._parseAllTrack = _parseAllTrack;
