import {FFmpegFilters, Filters} from "./Filters";
import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {Duplex, DuplexOptions, Readable, Writable} from "stream";
import {Logger} from "@Logger";
import {env} from "@env";
import fs from "fs";

const debug: boolean  = env.get("debug.ffmpeg");
const bitrate: string = env.get("music.audio.bitrate");
const name = env.get("ffmpeg.name");

export class FFmpeg extends Duplex {
    protected _process: ChildProcessWithoutNullStreams = null;
    protected _path: string    = null;
    protected _filters: string = null;
    protected _seek: number    = 0;
    public constructor(args: {seek: number, path: string, filters: Filters}, options: DuplexOptions = {}) {
        super({autoDestroy: true, objectMode: true, ...options});
        this._seek = args.seek; this._filters = FFmpegFilters.getRealFilters(args?.filters, args?.seek);
        this._path = args.path.endsWith(".opus") ? fs.realpathSync(args.path) : args.path;

        //Создаем процесс
        this._process = spawn(name, ["-vn", "-loglevel", "panic", ...this.arguments, "pipe:1"], {killSignal: "SIGKILL"});

        this.std = {methods: ["write", "end"], target: this.stdin};
        this.std = {methods: ["read", "setEncoding", "pipe", "unpipe"], target: this.stdout};
        this.caller = ["on", "once", "removeListener", "removeAllListeners", "listeners"];

        this.stderr.once("data", (d) => {
            Logger.error(`[FFmpeg]: ${d.toString()}\nArg: ${this._process.spawnargs}`);
        });

        if (debug) Logger.debug(`AudioPlayer: spawn process FFmpeg`);
    };


    /**
     * @description Данные выходящие из процесса
     */
    public get stdout() { return this?._process?.stdout; };


    /**
     * @description Данные входящие в процесс
     */
    public get stdin() { return this?._process?.stdin; };


    /**
     * @description Данные выходящие при ошибке
     */
    public get stderr() { return this?._process?.stderr; };


    /**
     * @description Получаем аргументы для запуска FFmpeg
     */
    private get arguments(): string[] {
        const Args: string[] = [];

        //Если используется ссылка
        if (this._path.startsWith("http")) Args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");

        //Добавляем пропуск если он указан
        if (this._seek) Args.push("-ss", `${this._seek}`);

        //Добавляем путь до файла
        Args.push("-i", this._path);

        //Добавляем фильтры если они указаны
        if (this._filters) Args.push("-af", this._filters);

        return [...Args, "-f", "opus" , "-b:a", bitrate];
    };


    /**
     * @description Создаем "привязанные функции"
     * @param methods {("on" | "once" | "removeListener" | "listeners" | )[]} Доступные методы
     */
    private set caller(methods: ("on" | "once" | "removeListener" | "listeners" | "removeAllListeners")[]) {
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
    private set std(options: processIn | processOut) {
        for (const method of options.methods) this[method] = (options.target as any)[method].bind(options.target);
    };


    /**
     * @description Можно ли удалить из памяти
     */
    public get deletable() { return !this._process?.killed || !this.destroyed || !!this._process; };


    /**
     * @description Удаляем все что не нужно
     */
    public _destroy = (): void => {
        //Убиваем процесс, если он еще жив
        if (this.deletable) this._process.kill("SIGKILL");

        this.stderr.removeAllListeners();
        this.stdin.removeAllListeners();
        this.stdout.removeAllListeners();
        this.removeAllListeners();

        this._process = null;
        this._filters  = null;
        this._path = null;
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