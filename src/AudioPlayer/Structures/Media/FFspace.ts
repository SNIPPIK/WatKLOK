import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { Duplex, DuplexOptions, Readable, Writable } from "stream";
import { dependencies } from "package.json";
import { Debug } from "@db/Config.json";
import { Logger } from "@Structures/Logger";

export { FFmpeg, FFprobe, Arguments };
//====================== ====================== ====================== ======================


type Arguments = Array<string | number> | Array<string>;
/**
 * @description Используется для модификации и конвертации потоков
 */
class FFmpeg extends Duplex {
    private process;

    public get deletable() { return !this.process?.killed || !this.destroyed || !!this.process; };
    public get stdout() { return this?.process?.stdout; };
    public get stdin() { return this?.process?.stdin; };

    public constructor(args: Arguments, options: DuplexOptions = {}) {
        super({ autoDestroy: true, objectMode: true, ...options });

        //Используется для загрузки потока в ffmpeg. Необходимо не указывать параметр -i
        if (!args.includes("-i")) args = ["-i", "-", ...args];
        this.process = runProcess(FFmpegName, [...args, "pipe:1"]);

        if (Debug) Logger.log(`FFmpeg: [Execute]`, true);

        this.setter(["write", "end"], this.stdin);
        this.setter(["read", "setEncoding", "pipe", "unpipe"], this.stdout);
        this.setter(["on", "once", "removeListener", "removeListeners", "listeners"]);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем "привязанные функции" (ПФ - термин из ECMAScript 6)
     * @param methods {string[]}
     * @param target {Readable | Writable}
     */
    private setter = (methods: string[], target?: Readable | Writable): void => {
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
     */
    public _destroy = (): void => {
        this.removeAllListeners();
        if (!super.destroyed) super.destroy();

        if (this.deletable) {
            this.process.removeAllListeners();
            this.process.kill("SIGKILL");
        }
        delete this.process;

        if (Debug) Logger.log(`FFmpeg: [Clear memory]`, true);
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные
 * @param url {string} Ссылка
 */
function FFprobe(url: string): Promise<JSON> {
    const ffprobe = runProcess(FFprobeName, ["-print_format", "json", "-show_format", "-i", url]);
    let information = "";
    const cleanup = () => { if (!ffprobe.killed) ffprobe.kill("SIGKILL"); }

    return new Promise((resolve) => {
        ffprobe.once("close", () => { cleanup(); return resolve(JSON.parse(information + "}")) });
        ffprobe.stdout.once("data", (data) => information += data.toString());
        ffprobe.once("error", cleanup);
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Запускаем процесс
 * @param name {string} Имя процесса
 * @param args {string[]} Аргументы процесса
 */
function runProcess(name: string, args: any[]): ChildProcessWithoutNullStreams & { stdout: { _readableState: Readable }, stdin: { _writableState: Writable } } {
    return spawn(name, args) as any;
}

//====================== ====================== ====================== ======================
/**
 * @description Делаем проверку наличия FFmpeg, FFprobe
 */
//====================== ====================== ====================== ======================
const paths = { ffmpeg: ["ffmpeg", "avconv"], ffprobe: ["ffprobe"] };
let FFmpegName: string, FFprobeName: string;

if (!FFmpegName) {
    //@ts-ignore
    try { if (dependencies["ffmpeg-static"]) paths.ffmpeg.push(require("ffmpeg-static")); } catch (e) {/* Null */ }

    FFmpegName = checkName(paths.ffmpeg, "FFmpeg not found! Music will not play, you need to install ffmpeg!");
    delete paths.ffmpeg;
}

if (!FFprobeName) {
    //@ts-ignore
    try { if (dependencies["ffprobe-static"]) paths.ffprobe.push(require("ffprobe-static").path); } catch (e) {/* Null */ }

    FFprobeName = checkName(paths.ffprobe, "FFprobe not found! Discord links and files won't work!");
    delete paths.ffprobe;
}
//====================== ====================== ====================== ======================
/**
 * @description Провеерка на наличие файла
 * @param names Имена процесса
 * @param error Ошибка если имя не найдено
 */
function checkName(names: string[], error: string) {
    for (const name of names) {
        const process = spawnSync(name, ["-h"], { windowsHide: true, shell: false });
        if (process.error) continue;
        return name;
    }
    Logger.error(error);
}