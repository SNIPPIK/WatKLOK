"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpsClient = void 0;
const https = __importStar(require("node:https"));
const YouTubeParameters = {
    timeout: 10000,
    headers: {
        'x-youtube-client-name': '1',
        'x-youtube-client-version': '2.20201021.03.00',
        'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7',
    }
};
const redirectCodes = new Set([301, 302, 303, 307, 308]);
class httpsClient {
    constructor(url) {
        this.getRes = async (options = {}) => new Promise(async (res) => https.get(this.url, { ...YouTubeParameters, ...options }, async (req) => res(this.AutoRedirect(options, req))));
        this._parseBody = async (options, body = null) => new Promise(async (res) => this.getRes(options).then(async (req) => {
            if (req.error)
                return res(null);
            req.on('data', async (chunk) => body += chunk);
            req.on('end', () => {
                req?.destroy();
                return res(body);
            });
        }));
        this._parseToJson = async (options) => this._parseBody(options).then(async (body) => {
            if (!body)
                return { error: true, message: 'Body is null' };
            return JSON.parse(body.split('null')[1]) ?? JSON.parse(body.split('undefined')[1]) ?? JSON.stringify(body);
        }).catch(async (e) => `invalid json response body at ${this.url} reason: ${e.message}`);
        this.AutoRedirect = async (options, req) => {
            if (req.statusCode === 200 || this.redirect >= 4)
                return req;
            else if (redirectCodes.has(req.statusCode)) {
                this.redirect++;
                this.url = req.headers.location ? req.headers.location : this.url;
                return this.getRes(options);
            }
            return { error: true };
        };
        this.url = url;
        this.redirect = 0;
    }
}
exports.httpsClient = httpsClient;
