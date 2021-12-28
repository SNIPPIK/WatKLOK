"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandSearch extends Constructor_1.Command {
    constructor() {
        super({
            name: "search",
            aliases: ["searh", "поиск", "seh"],
            description: "Поиск музыки на youtube",
            permissions: {
                client: ['SPEAK', 'CONNECT'],
                user: null
            },
            enable: true
        });
        this.run = async (message) => message.client.Send({ text: `${message.author}, ⚠ Эта команда была внесена в команду play.`, message: message, color: 'GREEN' });
    }
}
exports.default = CommandSearch;
