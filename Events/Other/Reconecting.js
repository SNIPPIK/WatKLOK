"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class shardReconnecting {
    constructor() {
        this.run = async () => console.log(`[WS]: Reconnecting...`);
        this.name = 'shardReconnecting';
        this.enable = true;
    }
}
exports.default = shardReconnecting;
