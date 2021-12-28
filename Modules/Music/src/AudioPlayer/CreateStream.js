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
exports.CreateStream = void 0;
const node_stream_1 = require("node:stream");
const node_child_process_1 = require("node:child_process");
const SPNK_1 = require("../../../../Core/SPNK");
const youtube_dl_1 = require("../../../../youtube-dl/youtube-dl");
const packageNpm = __importStar(require("../../../../package.json"));
const FFmpegPath = process.env.FFmpeg ? `${process.env.FFmpeg}` : packageNpm.dependencies["ffmpeg-static"] ? require('ffmpeg-static') : 'ffmpeg';
const SearchType = new Set(["SPOTIFY", "YANDEX"]);
const charCode = (x) => x.charCodeAt(0);
const OGGs_HEADER = Buffer.from([...'OggS'].map(charCode));
const OPUS_HEAD = Buffer.from([...'OpusHead'].map(charCode));
const OPUS_TAGS = Buffer.from([...'OpusTags'].map(charCode));
class CreateStream {
    constructor() {
        this.init = async (song, queue, seek = 0) => new Promise(async (res) => {
            if (!song.format)
                song.format = await this.getResFormats(song);
            return res(this.getFFmpegStream(song, queue, seek));
        });
        this.getFFmpegStream = async ({ format }, { options }, seek = 0) => new FFmpegStream(format, {
            encoderOptions: {
                seek: seek,
                bassboost: options.bass,
                noLossFrame: true,
                speed: options.speed
            }
        });
        this.getResFormats = async ({ type, url, title }) => SearchType.has(type) ? await this.getVideoYouTube(await this.SerFromYouTube(title)) : type === 'YOUTUBE' ? await this.getVideoYouTube(url) : await this.GetMetaYouTubeDL(url);
        this.GetMetaYouTubeDL = async (url) => new youtube_dl_1.YouTubeDL().getFormats([url]).then(this.Filter);
        this.SerFromYouTube = async (nameSong) => new SPNK_1.YouTube().searchVideos(nameSong, { limit: 10 }).then(this.FilterSearch);
        this.getVideoYouTube = async (url) => new SPNK_1.YouTube().getVideo(url).then((video) => video?.format || { url: undefined });
        this.Filter = (f) => f && f.formats ? f.formats.filter((f) => f.acodec === "opus")[0] : { url: undefined };
        this.FilterSearch = (f) => f?.length ? f[0].url : null;
    }
}
exports.CreateStream = CreateStream;
class FFmpegStream extends node_stream_1.PassThrough {
    constructor({ url, protocol, other }, { encoderOptions }) {
        super(Object.assign({ autoDestroy: true, readableObjectMode: true, highWaterMark: 1 << 25 }));
        this.constArg = (encoderOptions) => ["-reconnect", 1, "-reconnect_delay_max", 0, "-reconnect_streamed", 1,
            ...this._seek(encoderOptions), '-i', this.url, "-analyzeduration", 0, "-loglevel", 0,
            ...this._SpeedSong(encoderOptions), ...this._m3u8(), ...this._bassboost(encoderOptions), ...this._noLossFrame(encoderOptions), ...this._OggOpusCodec()
        ];
        this._m3u8 = () => this.isM3u8 ? ["-vn"] : [];
        this._bassboost = ({ bassboost }) => bassboost ? ["-af", `bass=g=${bassboost}`] : [];
        this._SpeedSong = ({ speed }) => speed > 0 ? ["-af", `atempo=${speed}`] : [];
        this._noLossFrame = ({ noLossFrame }) => noLossFrame || this.isM3u8 ? ["-crf", 0, "-qscale", 1 << 25] : [];
        this._seek = ({ seek }) => seek > 0 ? ['-ss', seek] : [];
        this._OggOpusCodec = () => ["-compression_level", 10, "-c:a", "libopus", "-f", "opus", "-ar", 48e3, "-ac", 2, "-preset", "ultrafast"];
        this._destroy = () => (this.FFmpeg.destroy(), delete this.FFmpeg, delete this.url, delete this.isM3u8, this.destroy());
        this.url = url;
        this.isM3u8 = !!other || !!protocol?.match(/m3u8/);
        this.FFmpeg = new FFmpeg(this.constArg(encoderOptions));
        return this.FFmpeg.pipe(this);
    }
    ;
}
class FFmpeg extends node_stream_1.Transform {
    constructor(args) {
        super({ autoDestroy: true, readableHighWaterMark: 25, writableHighWaterMark: 30 });
        this._transform = (chunk, encoding, done) => {
            while (chunk) {
                let res = this._readPage(chunk);
                if (!res)
                    break;
                chunk = res;
            }
            return done();
        };
        this._readPage = (chunk) => {
            if (this._checkReadPage(chunk))
                return false;
            const pageSegments = chunk.readUInt8(26);
            this._chunkSeg(chunk, pageSegments);
            let sizes = [], totalSize = 0;
            this._forPageSegments(sizes, pageSegments, totalSize, chunk);
            this._chunkTotal(chunk, pageSegments, totalSize);
            return this._readPageEnd(chunk, pageSegments, sizes);
        };
        this._readPageEnd = (chunk, pageSegments, sizes) => {
            const bitstream = chunk.readUInt32BE(14);
            let start = 27 + pageSegments;
            for (let size of sizes) {
                let segment = chunk.slice(start, start + size);
                let header = segment.slice(0, 8);
                this._TrSizeOfSizes(bitstream, segment, header);
                start += size;
            }
            return chunk.slice(start);
        };
        this._forPageSegments = (sizes, pageSegments, totalSize, chunk) => {
            const table = chunk.slice(27, 27 + pageSegments);
            for (let i = 0; i < pageSegments;) {
                let size = 0, x = 255;
                while (x === 255) {
                    if (i >= table.length)
                        return false;
                    x = table.readUInt8(i);
                    i++;
                    size += x;
                }
                sizes.push(size);
                totalSize += size;
            }
            return null;
        };
        this._chunkTotal = (chunk, pageSegments, totalSize) => chunk.length < 27 + pageSegments + totalSize ? false : null;
        this._chunkSeg = (chunk, pageSegments) => chunk.length < 27 + pageSegments ? false : null;
        this._checkReadPage = (chunk) => chunk.length < 26 ? true : !chunk.slice(0, 4).equals(OGGs_HEADER) ? Error(`capture_pattern is not ${OGGs_HEADER}`) : this._checkReadPageNext(chunk);
        this._checkReadPageNext = (chunk) => chunk.readUInt8(4) !== 0 ? Error(`stream_structure_version is not ${0}`) : chunk.length < 27;
        this._TrSizeOfSizes = (bitstream, segment, header) => this._head ? (header.equals(OPUS_TAGS) ? this.emit('tags', segment) : this._bitstream === bitstream ? this.push(segment) : null) : header.equals(OPUS_HEAD) ? (this.emit('head'), segment, this._head = segment, this._bitstream = bitstream) : this.emit('unknownSegment', segment);
        this._final = () => this.destroy();
        this._destroy = () => (this.process.kill(), delete this.process, delete this._head, delete this._bitstream, this.destroy());
        this.process = (0, node_child_process_1.spawn)(`${FFmpegPath}`, [...args, "pipe:1"]);
        this._bitstream = null;
        this._head = null;
        return this.process.stdout.pipe(this);
    }
}
