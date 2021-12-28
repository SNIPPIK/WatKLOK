"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ConvertedText {
    constructor() {
        this.run = (client) => client.ConvertedText = (text, value, clearText = false) => {
            try {
                if (clearText)
                    text = text.replace('[', '').replace(']', '');
                if (text.length > value && value !== false) {
                    return `${text.substring(0, value)}...`;
                }
                else
                    return text;
            }
            catch (e) {
                return text;
            }
        };
        this.enable = true;
    }
    ;
}
exports.default = ConvertedText;
