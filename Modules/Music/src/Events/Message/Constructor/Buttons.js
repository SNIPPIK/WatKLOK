"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunButt = void 0;
const discord_js_1 = require("discord.js");
class Buttons extends discord_js_1.MessageButton {
    constructor(options) {
        super(options);
    }
    ;
}
function RunButt() {
    return new discord_js_1.MessageActionRow().addComponents(new Buttons({
        customId: "skip",
        emoji: "⏭",
        style: "SECONDARY",
        label: "Skip"
    }), new Buttons({
        customId: "pause",
        emoji: "⏸",
        style: "SECONDARY",
        label: "Pause"
    }), new Buttons({
        customId: "resume",
        emoji: "▶️",
        style: "SECONDARY",
        label: "Resume"
    }), new Buttons({
        customId: "replay",
        emoji: "🔄",
        style: "SECONDARY",
        label: "Replay"
    }));
}
exports.RunButt = RunButt;
