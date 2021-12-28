"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
const ParserTimeSong_1 = require("../../Modules/Music/src/Manager/Functions/ParserTimeSong");
class CommandUptime extends Constructor_1.Command {
    constructor() {
        super({
            name: 'uptime',
            description: 'Мое время работы без перезагрузок',
            enable: true
        });
        this.run = async (message) => message.client.Send({ text: `Uptime: ${(0, ParserTimeSong_1.ParserTimeSong)(message.client.uptime / 1000)}`, message: message, type: 'css', color: 'GREEN' });
    }
}
exports.default = CommandUptime;
