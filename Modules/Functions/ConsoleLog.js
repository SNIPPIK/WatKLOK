"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ConsoleLog {
    constructor() {
        this.run = (client) => client.console = (set) => console.log(`[${(new Date).toLocaleString("ru")}] ${set}`);
        this.enable = true;
    }
    ;
}
exports.default = ConsoleLog;
