"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StringTime = void 0;
function StringTime(duration) {
    return (duration < 10) ? ('0' + duration) : duration;
}
exports.StringTime = StringTime;
