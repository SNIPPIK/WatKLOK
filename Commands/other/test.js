"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandTest extends Constructor_1.Command {
    constructor() {
        super({
            name: 'test',
            enable: true,
            isOwner: true,
            slash: false
        });
        this.run = async (message, args) => {
        };
    }
    ;
}
exports.default = CommandTest;
