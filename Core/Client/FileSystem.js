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
exports.LoadCommands = exports.Load = void 0;
const fs_1 = require("fs");
const maxLenStringDir = 9;
class MultiLoader {
    constructor(options) {
        this.readdirSync = () => {
            (0, fs_1.readdirSync)(this.path).forEach((dir) => {
                if (dir.endsWith(".js") || dir.endsWith(".ts"))
                    return null;
                let dirs = (0, fs_1.readdirSync)(`${this.path}/${dir}/`).filter((d) => (d.endsWith('.js') || d.endsWith('.ts')));
                return this.ForLoad(dirs, dir);
            });
        };
        this.ForLoad = async (dirs, dir) => {
            for (let file of dirs) {
                let pull;
                try {
                    pull = new ((await Promise.resolve().then(() => __importStar(require(`../../${this.path}/${dir}/${file}`)))).default);
                    pull.type = dir;
                    if (!pull.enable)
                        continue;
                }
                catch (e) {
                    console.log(e);
                    if (e)
                        continue;
                }
                this.callback(pull, {
                    dir: dir,
                    file: file
                });
            }
        };
        this.name = options.name;
        this.path = options.path;
        this.callback = options.callback;
    }
    ;
}
async function Load(client) {
    new MultiLoader({
        name: 'Commands',
        path: 'Commands',
        callback: (pull, op) => {
            let { dir, file } = op;
            if (pull.name) {
                client.commands.set(pull.name, pull);
                console.log(`[${AddTime()}] ->  Status: [✔️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
            else {
                console.log(`[${AddTime()}] ->  Status: [✖️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
            if (pull.aliases && Array.isArray(pull.aliases))
                pull.aliases.forEach((alias) => client.aliases.set(alias, pull.name));
        }
    }).readdirSync();
    new MultiLoader({
        name: 'Events',
        path: 'Events',
        callback: (pull, op) => {
            let { dir, file } = op;
            if (pull) {
                client.on(pull.name, async (f1, f2) => pull.run(f1, f2, client));
                console.log(`[${AddTime()}] ->  Status: [✔️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
            else {
                console.log(`[${AddTime()}] ->  Status: [✖️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
        }
    }).readdirSync();
    new MultiLoader({
        name: 'Modules',
        path: 'Modules',
        callback: (pull, op) => {
            let { dir, file } = op;
            if (pull) {
                pull.run(client);
                console.log(`[${AddTime()}] ->  Status: [✔️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
            else {
                console.log(`[${AddTime()}] ->  Status: [✖️] | Type: [${FileType(file)}] | Directory: [${dir}] ${AddSpace(dir)} | NameFile: [${file}]`);
            }
        }
    }).readdirSync();
}
exports.Load = Load;
async function LoadCommands(client) {
    new MultiLoader({
        name: 'Commands',
        path: 'Commands',
        callback: (pull) => {
            if (pull.DeleteMessage)
                delete pull.DeleteMessage;
            client.commands.push(pull);
        }
    }).readdirSync();
}
exports.LoadCommands = LoadCommands;
function FileType(file) {
    return file.endsWith('.ts') ? `TS` : `JS`;
}
function AddSpace(dir) {
    let textSize = dir.length;
    return textSize < maxLenStringDir ? (' ').repeat(maxLenStringDir - textSize) : '';
}
function AddTime() {
    return 'FileSystem';
}
