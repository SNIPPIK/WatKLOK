"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
class Utils {
    constructor() {
        this._FindFormat = async (formats) => {
            let format = await this._Opus(formats);
            return format ? format : formats?.length >= 1 ? formats[0] : null;
        };
        this._Opus = async (formats) => formats ? formats.filter(f => !f.protocol.match(/m3u8/) && f.ext.match(/mp4/))[0] : null;
    }
}
exports.Utils = Utils;
