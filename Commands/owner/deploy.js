"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Constructor_1 = require("../Constructor");
class CommandDeploy extends Constructor_1.Command {
    constructor() {
        super({
            name: 'deploy',
            enable: true,
            isOwner: true,
            slash: false
        });
        this.run = async (message) => {
            let commands = message.client.commands, TotalCommands = 0;
            try {
                commands.map(async (cmd) => {
                    if (cmd.isOwner || !cmd.slash || !cmd.enable)
                        return;
                    try {
                        await message.client.application.commands.set(cmd);
                    }
                    catch (e) {
                        await message.client.application.commands.create(cmd);
                    }
                    TotalCommands++;
                });
            }
            finally {
                await message.client.Send({ text: `${message.author}, [${TotalCommands}] команд загружено`, message: message });
            }
        };
    }
    ;
}
exports.default = CommandDeploy;
