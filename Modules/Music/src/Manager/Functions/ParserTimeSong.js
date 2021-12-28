"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserTimeSong = void 0;
const StringTime_1 = require("./StringTime");
function ParserTimeSong(duration) {
    let days = ParseToDate(duration / ((60 * 60) * 24) % 24);
    let hours = ParseToDate(duration / (60 * 60) % 24);
    let minutes = ParseToDate((duration / 60) % 60);
    let seconds = ParseToDate(duration % 60);
    return (days > 0 ? `${days}:` : '') + (hours > 0 || days > 0 ? `${hours}:` : '') + (minutes > 0 ? `${minutes}:` : '00:') + (seconds > 0 ? `${seconds}` : '00');
}
exports.ParserTimeSong = ParserTimeSong;
function ParseToDate(duration) {
    return (0, StringTime_1.StringTime)(parseInt(String(duration)));
}
