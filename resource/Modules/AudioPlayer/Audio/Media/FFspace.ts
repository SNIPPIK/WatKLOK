import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { Duplex, DuplexOptions, Readable, Writable } from "stream";
import { dependencies } from "package.json";
import { Debug } from "@db/Config.json";
import { Logger } from "@Logger";

export { FFmpeg, FFprobe, Arguments };

/**
 * @description Используется для модификации и конвертации потоков
 */
class FFmpeg extends Duplex {
    /**
     * @description Процесс 
     */
    private process: ChildProcessWithoutNullStreams;
    //====================== ====================== ====================== ======================
    //====================== ====================== ====================== ======================
    /**
     * @description Жив ли процесс
     */
    public get deletable() { return !this.process?.killed || !this.destroyed || !!this.process; };
    //====================== ====================== ====================== ======================
    /**
     * @description Данные выходящие из процесса
     */
    public get stdout() { return this?.process?.stdout; };
    //====================== ====================== ====================== ======================
    /**
     * @description Данные входящие в процесс
     */
    public get stdin() { return this?.process?.stdin; };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем "привязанные функции"
     * @param options {methods: string[], target: Readable | Writable}
     */
    private set setter({methods, target}: {methods: string[], target?: Readable | Writable}) {
        // @ts-ignore
        if (target) return methods.forEach((method) => this[method] = target[method].bind(target));
        else {
            const EVENTS = { readable: this.stdout, data: this.stdout, end: this.stdout, unpipe: this.stdout, finish: this.stdin, close: this.stdin, drain: this.stdin };
            // @ts-ignore
            methods.forEach((method) => this[method] = (ev, fn) => EVENTS[ev] ? EVENTS[ev][method](ev, fn) : Duplex.prototype[method].call(this, ev, fn));
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем процесс
     * @param args {Arguments} Аргументы для запуска
     */
    private set spawning(args: Arguments) {
        //Используется для загрузки потока в ffmpeg. Необходимо не указывать параметр -i
        if (!args.includes("-i")) args = ["-i", "-", ...args];

        //Создаем процесс
        this.process = spawn(FFmpegName, [...args, "pipe:1"] as any);

        if (Debug) Logger.debug(`[AudioPlayer]: [FFmpeg lib]: running ffmpeg`);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем FFmpeg 
     * @param args {Arguments} Аргументы запуска
     * @param options {DuplexOptions} Модификации потока
     */
    public constructor(args: Arguments, options: DuplexOptions = {}) {
        super({ autoDestroy: true, objectMode: true, ...options });

        this.spawning = args;
        this.setter = {methods: ["write", "end"], target: this.stdin};
        this.setter = {methods: ["read", "setEncoding", "pipe", "unpipe"], target: this.stdout};
        this.setter = {methods: ["on", "once", "removeListener", "removeListeners", "listeners"]};
    };
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
        this.process = null;

        if (Debug) Logger.debug(`[AudioPlayer]: [FFmpeg lib]: Destroying!`);
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем данные
 * @param url {string} Ссылка
 */
function FFprobe(url: string): Promise<JSON> {
    const process = spawn(FFprobeName, ["-print_format", "json", "-show_format", "-i", url]);
    let information = "";
    const cleanup = () => { if (!process.killed) process.kill("SIGKILL"); }

    return new Promise((resolve) => {
        process.once("close", () => { cleanup(); return resolve(JSON.parse(information + "}")) });
        process.stdout.once("data", (data) => information += data.toString());
        process.once("error", cleanup);
    });
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
 * @description Проверка на наличие файла
 * @param names Имена процесса
 * @param error Ошибка если имя не найдено
 */
function checkName(names: string[], error: string) {
    for (const name of names) {
        const process = spawnSync(name, ["-h"], { windowsHide: true, shell: false });
        if (process.error) continue;
        return name;
    }
    console.log(error);
}
//====================== ====================== ====================== ======================
/**
 * @description Допустимые аргументы для FFmpeg
 */
type Arguments = Array<string | number> | Array<string>;