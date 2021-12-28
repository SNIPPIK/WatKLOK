"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class shardDisconnect {
    constructor() {
        this.run = async () => console.log(`[WS]: Disconnecting...`);
        this.name = 'shardDisconnect';
        this.enable = true;
    }
}
exports.default = shardDisconnect;
