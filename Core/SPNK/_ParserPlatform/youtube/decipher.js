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
exports.decipherFormats = void 0;
const querystring = __importStar(require("node:querystring"));
const Utils_1 = require("./Utils");
const vm = __importStar(require("node:vm"));
const https_1 = require("./https");
async function getFunctions(html5player) {
    const body = await new https_1.httpsClient(html5player)._parseBody();
    const functions = await extractFunctions(body);
    return !functions || !functions.length ? null : functions;
}
async function extractFunctions(body) {
    const functions = [];
    const extractManipulations = async (caller) => {
        const functionName = new Utils_1.Utils().between(caller, `a=a.split("");`, `.`);
        if (!functionName)
            return '';
        const functionStart = `var ${functionName}={`;
        const ndx = body.indexOf(functionStart);
        if (ndx < 0)
            return '';
        const subBody = body.slice(ndx + functionStart.length - 1);
        return `var ${functionName}=${new Utils_1.Utils().cutAfterJSON(subBody)}`;
    };
    const extractDecipher = async () => {
        const functionName = new Utils_1.Utils().between(body, `a.set("alr","yes");c&&(c=`, `(decodeURIC`);
        if (functionName && functionName.length) {
            const functionStart = `${functionName}=function(a)`;
            const ndx = body.indexOf(functionStart);
            if (ndx >= 0) {
                const subBody = body.slice(ndx + functionStart.length);
                let functionBody = `var ${functionStart}${new Utils_1.Utils().cutAfterJSON(subBody)}`;
                functionBody = `${await extractManipulations(functionBody)};${functionBody};${functionName}(sig);`;
                functions.push(functionBody);
            }
        }
    };
    const extractNCode = async () => {
        const functionName = new Utils_1.Utils().between(body, `&&(b=a.get("n"))&&(b=`, `(b)`);
        if (functionName && functionName.length) {
            const functionStart = `${functionName}=function(a)`;
            const ndx = body.indexOf(functionStart);
            if (ndx >= 0) {
                const subBody = body.slice(ndx + functionStart.length);
                const functionBody = `var ${functionStart}${new Utils_1.Utils().cutAfterJSON(subBody)};${functionName}(ncode);`;
                functions.push(functionBody);
            }
        }
    };
    await extractDecipher();
    await extractNCode();
    return functions;
}
async function setDownloadURL(format, decipherScript, nTransformScript) {
    const decipher = async (url) => {
        const args = querystring.parse(url);
        if (!args.s || !decipherScript)
            return args.url;
        const components = new URL(decodeURIComponent(args.url));
        components.searchParams.set(args.sp ? args.sp : 'signature', decipherScript.runInNewContext({ sig: decodeURIComponent(args.s) }));
        return components.toString();
    };
    const EncodeCode = async (url) => {
        const components = new URL(decodeURIComponent(url));
        const n = components.searchParams.get('n');
        if (!n || !nTransformScript)
            return url;
        components.searchParams.set('n', nTransformScript.runInNewContext({ ncode: n }));
        return components.toString();
    };
    const url = format.url || format.signatureCipher || format.cipher;
    format.url = !format.url ? await EncodeCode(await decipher(url)) : await EncodeCode(url);
    delete format.signatureCipher;
    delete format.cipher;
}
async function decipherFormats(formats, html5player) {
    let functions = await getFunctions(html5player);
    const decipherScript = functions.length ? new vm.Script(functions[0]) : null;
    const nTransformScript = functions.length > 1 ? new vm.Script(functions[1]) : null;
    formats.forEach((format) => setDownloadURL(format, decipherScript, nTransformScript));
    return formats;
}
exports.decipherFormats = decipherFormats;
