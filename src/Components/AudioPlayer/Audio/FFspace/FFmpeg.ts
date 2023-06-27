import {AudioFilters, Filters} from "@AudioPlayer/Audio/AudioFilters";
import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {Duplex, DuplexOptions, Readable, Writable} from "stream";
import {Logger} from "@Utils/Logger";
import {env} from "@Client/Fs";
import fs from "fs";

const debug: boolean  = env.get("debug.ffmpeg");
const bitrate: string = env.get("music.audio.bitrate");
const name = env.get("ffmpeg.name");

export class FFmpeg extends Duplex {
    private _process: ChildProcessWithoutNullStreams;
    private _path: fs.ReadStream | string;
    private _filters: string;
    private _seek: number;

    /**
     * @description Данные выходящие из процесса
     */
    public get stdout() { return this?._process?.stdout; };


    /**
     * @description Данные входящие в процесс
     */
    public get stdin() { return this?._process?.stdin; };


    /**
     * @description Получаем аргументы для запуска FFmpeg
     * @protected
     */
    private get arguments(): string[] {
        const Args: string[] = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"];

        //Добавляем пропуск если он указан
        if (this._seek) Args.push("-ss", `${this._seek ?? 0}`);

        //Добавляем путь до файла
        if (typeof this._path === "string") Args.push("-i", this._path);
        else Args.push("-i", "-");

        //Добавляем фильтры если они указаны
        if (this._filters) Args.push("-af", this._filters);

        return [...Args, "-thread_queue_size", "64", "-f", "opus", "-b:a", bitrate, "-intra-refresh", "1"];
    };


    /**
     * @description Создаем "привязанные функции"
     * @param methods {("on" | "once" | "removeListener" | "listeners" | )[]} Доступные методы
     */
    private set setter(methods: ("on" | "once" | "removeListener" | "listeners" | "removeAllListeners")[]) {
        const EVENTS = { readable: this.stdout, data: this.stdout, end: this.stdout, unpipe: this.stdout, finish: this.stdin, close: this.stdin, drain: this.stdin };

        for (const method of methods) (this[method] as any) = (ev: any, fn: any): any => {
            if (EVENTS[ev as "data"]) return EVENTS[ev as "data"][method](ev, fn);
            return Duplex.prototype[method].call(this, ev, fn);
        }
    };


    /**
     * @description Добавляем методы запросов к options.target
     * @param options {processIn | processOut} Вариации запросов
     */
    private set setProcessST(options: processIn | processOut) { for (const method of options.methods) this[method] = (options.target as any)[method].bind(options.target); };


    /**
     * @description Создаем FFmpeg
     * @param args
     * @param options {DuplexOptions} Модификации потока
     */
    public constructor(args: {seek: number, path: string, filters: Filters}, options: DuplexOptions = {}) {
        super({autoDestroy: true, objectMode: true, ...options});
        this._seek = args.seek; this._filters = AudioFilters.getVanillaFilters(args?.filters, args?.seek);
        this._path = args.path.endsWith("opus") ? fs.createReadStream(args.path) : args.path;

        //Создаем процесс
        this._process = spawn(name, ["-vn", "-sn", "-dn", "-loglevel", "error", ...this.arguments, "pipe:1"]);

        this.setProcessST = {methods: ["write", "end"], target: this.stdin};
        this.setProcessST = {methods: ["read", "setEncoding", "pipe", "unpipe"], target: this.stdout};
        this.setter = ["on", "once", "removeListener", "listeners", "removeAllListeners"];

        if (debug) {
            this._process.stderr.on("data", (d) => console.log(this._process.spawnargs, d.toString()));
            Logger.debug(`AudioPlayer: spawn process ${name}`);
        }
    };


    /**
     * @description Можно ли удалить из памяти
     */
    public get deletable() { return !this._process?.killed || !this.destroyed || !!this._process; };


    /**
     * @description Удаляем все что не нужно
     */
    public _destroy = (): void => {
        this.removeAllListeners();
        if (!super.destroyed) super.destroy();

        if (this.deletable) this._process.kill("SIGKILL");

        this._process = null;
        this._path = null;
        this._filters = null;
        this._seek = null;
    };
}


interface processIn {
    methods: ("write" | "end")[];
    target: Writable;
}

interface processOut {
    methods: ("read" | "setEncoding" | "pipe" | "unpipe")[];
    target: Readable;
}