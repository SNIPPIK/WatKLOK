"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
const https_1 = require("./https");
class Utils {
    constructor() {
        this.RequestExp = async (url, options = {}) => new https_1.httpsClient(url)._parseBody({ ...options, ...(process.env.YTcookie !== undefined ? { headers: { 'cookie': process.env.YTcookie } } : {}) }).then(async (body) => !body ? null : body);
        this._FindOpusFormat = async (formats, isLive = false) => isLive ? null : formats.length >= 1 ? formats.filter(f => f.acodec === 'opus' || !f.fps)[0] : null;
        this.FindPlayer = (body) => body.split('var ytInitialPlayerResponse = ')?.[1]?.split(';</script>')[0].split(/;\s*(var|const|let)/)[0];
        this.getID = (url) => {
            if (typeof url !== 'string')
                return 'Url is not string';
            let _parseUrl = new URL(url);
            if (_parseUrl.searchParams.get('v'))
                return _parseUrl.searchParams.get('v');
            else if (_parseUrl.searchParams.get('list'))
                return _parseUrl.searchParams.get('list');
            return new URL(url).pathname.split('/')[1];
        };
        this.between = (haystack, left, right) => {
            let pos;
            if (left instanceof RegExp) {
                const match = haystack.match(left);
                if (!match) {
                    return '';
                }
                pos = match.index + match[0].length;
            }
            else {
                pos = haystack.indexOf(left);
                if (pos === -1) {
                    return '';
                }
                pos += left.length;
            }
            haystack = haystack.slice(pos);
            pos = haystack.indexOf(right);
            if (pos === -1) {
                return '';
            }
            haystack = haystack.slice(0, pos);
            return haystack;
        };
        this.cutAfterJSON = (mixedJson) => {
            let open, close;
            if (mixedJson[0] === '[') {
                open = '[';
                close = ']';
            }
            else if (mixedJson[0] === '{') {
                open = '{';
                close = '}';
            }
            if (!open)
                throw new Error(`Can't cut unsupported JSON (need to begin with [ or { ) but got: ${mixedJson[0]}`);
            let isString = false;
            let isEscaped = false;
            let counter = 0;
            for (let i = 0; i < mixedJson.length; i++) {
                if (mixedJson[i] === '"' && !isEscaped) {
                    isString = !isString;
                    continue;
                }
                isEscaped = mixedJson[i] === '\\' && !isEscaped;
                if (isString)
                    continue;
                if (mixedJson[i] === open)
                    counter++;
                else if (mixedJson[i] === close)
                    counter--;
                if (counter === 0)
                    return mixedJson.substring(0, i + 1);
            }
            throw Error("Can't cut unsupported JSON (no matching closing bracket found)");
        };
    }
}
exports.Utils = Utils;
