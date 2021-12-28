"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Command = void 0;
class Command {
    constructor({ name = null, aliases = [], description = "Нету описания", permissions = {
        client: [],
        user: []
    }, isOwner = false, enable = false, slash = false, type = "", }) {
        this.DeleteMessage = (message, time = 2e3) => setTimeout(() => message.delete().catch(() => null), time);
        this.name = name;
        this.aliases = aliases;
        this.description = description;
        this.permissions = permissions;
        this.isOwner = isOwner;
        this.slash = slash;
        this.enable = enable;
        this.type = type;
    }
}
exports.Command = Command;
