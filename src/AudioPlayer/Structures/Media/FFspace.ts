import {ChildProcessWithoutNullStreams, spawn, spawnSync} from "child_process";
import {Duplex, DuplexOptions, Readable, Writable} from "stream";
import AudioFilters from "@db/Filters.json";
import {consoleTime} from "@Client/Client";
import {dependencies} from "package.json";
import {Debug} from "@db/Config.json";

const paths = {
    ffmpeg: ["ffmpeg", "avconv"],
    ffprobe: ["ffprobe"]
}
let FFmpegName: string, FFprobeName: string;

function CheckFile(paths: string[], error: string) {
    for (let path of paths) {
        const result = spawnSync(path, ["-h"], {windowsHide: true, shell: false});
        if (result.error) continue;
        return path;
    }
    throw Error(error);
}

//Проверяем есть ли FFmpeg в системе
if (!FFmpegName) {
    try { if (Object.keys(dependencies).includes("ffmpeg-static")) paths.ffmpeg.push(require("ffmpeg-static")); } catch (e) {/* Null */}

    FFmpegName = CheckFile(paths.ffmpeg, "FFmpeg not found!");
    delete paths.ffmpeg;
}
//Проверяем есть ли FFprobe в системе
if (!FFprobeName) {
    try { if (Object.keys(dependencies).includes("ffprobe-static")) paths.ffprobe.push(require("ffprobe-static").path); } catch (e) {/* Null */}

    FFprobeName = CheckFile(paths.ffprobe, "FFprobe not found!");
    delete paths.ffprobe;
}


export namespace FFspace {
    export type Arguments = Array<string | number> | Array<string>;

    /**
     * ffmpeg is a very fast video and audio converter that can also grab from a live audio/video source. It can also convert between arbitrary sample rates and resize video on the fly with a high quality polyphase filter.
     * ffmpeg reads from an arbitrary number of input "files" (which can be regular files, pipes, network streams, grabbing devices, etc.), specified by the -i option, and writes to an arbitrary number of output "files", which are specified by a plain output url. Anything found on the command line which cannot be interpreted as an option is considered to be an output url.
     * Each input or output url can, in principle, contain any number of streams of different types (video/audio/subtitle/attachment/data). The allowed number and/or types of streams may be limited by the container format. Selecting which streams from which inputs will go into which output is either done automatically or with the -map option (see the Stream selection chapter).
     * To refer to input files in options, you must use their indices (0-based). E.g. the first input file is 0, the second is 1, etc. Similarly, streams within a file are referred to by their indices. E.g. 2:3 refers to the fourth stream in the third input file. Also see the Stream specifiers chapter.
     * As a general rule, options are applied to the next specified file. Therefore, order is important, and you can have the same option on the command line multiple times. Each occurrence is then applied to the next input or output file. Exceptions to this rule are the global options (e.g. verbosity level), which should be specified first.
     */
    export class FFmpeg extends Duplex {
        private process;

        /**
         * @description Запускаем FFmpeg
         * @param args {Arguments} Аргументы запуска
         * @param options {DuplexOptions} Настройки node Stream
         */
        public constructor(args: Arguments, options: DuplexOptions = {}) {
            super({autoDestroy: true, objectMode: true, ...options});

            //Используется для загрузки потока в ffmpeg. Необходимо не указывать параметр -i
            if (!args.includes("-i")) args = ["-i", "-", ...args];
            this.process = runProcess(FFmpegName, [...args, "pipe:1"]);

            if (Debug) consoleTime(`[Debug] -> FFmpeg: [Execute]`);

            this.setter(["write", "end"], this.stdin);
            this.setter(["read", "setEncoding", "pipe", "unpipe"], this.stdout);
            this.setter(["on", "once", "removeListener", "removeListeners", "listeners"]);
        }
        public get deletable() { return !this.process?.killed || !this.destroyed || !!this.process; };

        //====================== ====================== ====================== ======================
        /**
         * @description Выход
         * @private
         */
        public get stdout() { return this?.process?.stdout; };
        //====================== ====================== ====================== ======================
        /**
         * @description Вход
         */
        public get stdin() { return this?.process?.stdin; };
        //====================== ====================== ====================== ======================
        /**
         * @description Создаем "привязанные функции" (ПФ - термин из ECMAScript 6)
         * @param methods {string[]}
         * @param target {Readable | Writable}
         */
        private setter = (methods: string[], target?: Readable | Writable) => {
            // @ts-ignore
            if (target) return methods.forEach((method) => this[method] = target[method].bind(target));
            else {
                const EVENTS = { readable: this.stdout, data: this.stdout, end: this.stdout, unpipe: this.stdout, finish: this.stdin, close: this.stdin, drain: this.stdin };
                // @ts-ignore
                methods.forEach((method) => this[method] = (ev, fn) => EVENTS[ev] ? EVENTS[ev][method](ev, fn) : Duplex.prototype[method].call(this, ev, fn));
            }
        }
        //====================== ====================== ====================== ======================
        /**
         * @description Удаляем все что не нужно
         * @param error {Error | null} По какой ошибке завершаем работу FFmpeg'a
         */
        public _destroy = (error?: Error | null) => {
            this.removeAllListeners();
            if (!super.destroyed) super.destroy();

            [this.process.stdin, this.process.stdout, this.process.stderr].forEach((stream) => {
                if (stream !== undefined && !stream.destroyed) {
                    stream.removeAllListeners();
                    stream.destroy();
                }
            });

            if (this.deletable) {
                this.process.removeAllListeners();
                this.process.kill("SIGKILL");
            }

            delete this.process;

            if (Debug) consoleTime(`[Debug] -> FFmpeg: [Clear memory]`);
            if (error) return console.error(error);
        };
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные
     * @param url {string} Ссылка
     */
    export function FFprobe(url: string): Promise<JSON> {
        const ffprobe = runProcess(FFprobeName, ["-print_format", "json", "-show_format", "-i", url]);
        let information = "";
        const cleanup = () => {
            if (!ffprobe.killed) ffprobe.kill("SIGKILL");
        }

        return new Promise((resolve) => {
            ffprobe.once("close", () => { cleanup();return resolve(JSON.parse(information + "}"))});
            ffprobe.stdout.once("data", (data) => information += data.toString());
            ffprobe.once("error", cleanup);
        });
    }

    //Ищем Filter в Array<Filter>
    export function getFilter(name: string): typeof AudioFilters[0] { return AudioFilters.find((fn) => fn.names.includes(name)); }
}

function runProcess(file: string, args: any[]): ChildProcessWithoutNullStreams & { stdout: { _readableState: Readable }, stdin: { _writableState: Writable } } {
    return spawn(file, args, {shell: false}) as any;
}