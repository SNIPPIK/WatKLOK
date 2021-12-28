"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FullTimeSongs = void 0;
const ParserTimeSong_1 = require("./ParserTimeSong");
const Queue_1 = require("../Queue/Constructors/Queue");
function FullTimeSongs(queue) {
    let Timer = 0;
    if (queue instanceof Queue_1.Queue)
        queue.songs.map((song) => Timer += song.duration.seconds);
    else
        queue.map((song) => Timer += parseInt(song.duration.seconds));
    return (0, ParserTimeSong_1.ParserTimeSong)(Timer);
}
exports.FullTimeSongs = FullTimeSongs;
