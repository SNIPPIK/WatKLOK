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
exports.YouTubeDL = void 0;
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
const node_stream_1 = require("node:stream");
const node_os_1 = require("node:os");
const https = __importStar(require("node:https"));
const File = (0, node_os_1.platform)() === "win32" ? "youtube-dl.exe" : "youtube-dl";
const fullPath = __dirname + '/';
class YouTubeDL {
    constructor() {
        this.getMetadata = async (options = []) => {
            options = [...options, "--dump-json"];
            let youtubeDlStdout = await new ClassSpawn().execFile(options);
            try {
                return JSON.parse(youtubeDlStdout);
            }
            catch (e) {
                return JSON.parse("[" + youtubeDlStdout.replace(/\n/g, ",").slice(0, -1) + "]");
            }
        };
        this.getFormats = async (options) => this.getMetadata([...options, ...(this._addFormat(options))]);
        this.getStream = async (options = []) => {
            const readStream = new node_stream_1.Readable({});
            options = [...options, "-o", "-"];
            const youtubeDlProcess = await new ClassSpawn().SpawnYouTubeDL(options);
            let stderrData = "", processError;
            youtubeDlProcess.stdout.on("data", (data) => readStream.push(data));
            youtubeDlProcess.stderr.on("data", (data) => stderrData += data.toString());
            youtubeDlProcess.on("error", (error) => processError = error);
            youtubeDlProcess.on("close", () => readStream.destroy());
            return readStream;
        };
        this.clearRun = (options = []) => new ClassSpawn().execFile();
        this.download = () => new downloader().downloadFile();
        this._addFormat = (options) => !options.includes("-f") && !options.includes("--format") ? ["-f", "best"] : [];
    }
}
exports.YouTubeDL = YouTubeDL;
class downloader {
    constructor() {
        this.downloadFile = () => !(0, node_fs_1.existsSync)(`${fullPath}${File}`) ? this._redirect() : null;
        this._redirect = (url = null) => https.get(!url ? `https://youtube-dl.org/downloads/latest/${File}` : url, (req) => {
            if (req.statusCode === 200) {
                if (!(0, node_fs_1.existsSync)(`${fullPath}`))
                    (0, node_fs_1.mkdirSync)(`${fullPath}`);
                return req.pipe((0, node_fs_1.createWriteStream)(`${fullPath}${File}`));
            }
            else if (req.statusCode === 302)
                return this._redirect(req.headers.location);
            else
                throw Error(`[YouTubeDl Installer: ${req.statusCode}]: [${req.statusMessage}]`);
        });
    }
}
class ClassSpawn {
    constructor() {
        this.SpawnYouTubeDL = async (options) => (0, node_child_process_1.spawn)(fullPath + File, options);
        this.execFile = async (youtubeDlArguments = []) => new Promise(async (resolve) => (0, node_child_process_1.execFile)(fullPath + File, youtubeDlArguments, { maxBuffer: 1024 * 1024 * 1024 }, async (err, out) => resolve(out)));
    }
}
