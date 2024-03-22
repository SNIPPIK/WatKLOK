import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {OpusEncoder} from "@lib/voice/utils/Opus";

/**
 * @author SNIPPIK
 * @description Конвертирует аудио в нужный формат
 * @class AudioResource
 */
export class AudioResource {
    private readonly streams: (OpusEncoder | Process)[] = [new OpusEncoder()];
    private readonly parameters = { readable: false, ended: false };
    private _duration = new class {
        private frame = 20;
        private sizes = 0;

        public get current() {
            const duration = ((this.sizes * this.frame) / 1e3).toFixed(0);

            return parseInt(duration);
        };

        public set current(current) {
            this.sizes = (current * 1e3) / this.frame;
        };

        protected set editFrame(frame: number) {
            this.frame = frame
        };

        protected set pushFrame(frame: number) {
            this.sizes += frame;
        };
    };
    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @public
     */
    public get duration() { return this._duration; };

    /**
     * @description Начато ли чтение потока
     * @return boolean
     * @public
     */
    public get readable() { return this.parameters.readable; };

    /**
     * @description Выдаем фрагмент потока
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        const packet = this.stream.read();

        if (packet) this.duration["pushFrame"] = 1;
        return packet;
    };

    /**
     * @description Получаем OpusEncoder
     * @return OpusEncoder
     * @public
     */
    public get stream() { return this.streams.at(0) as OpusEncoder; };

    /**
     * @description Получаем Process
     * @return Process
     * @public
     */
    public get process() { return this.streams.at(1) as Process; }

    /**
     * @description Задаем параметры запуска ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set create(options: {path: string, seek?: number; filters?: string}) {
        const urls = options.path.split(":|");

        this.streams.push(new Process(["-vn", "-loglevel", "panic",
            ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
            "-ss", `${options.seek ?? 0}`, "-i", urls[1],
            ...(options.filters ? ["-af", options.filters]: []),
            "-f", `${OpusEncoder.lib.ffmpeg}`, "pipe:1"
        ]));
    };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set input(options: {input: NodeJS.ReadWriteStream, events: string[]}) {
        for (const event of options.events) options.input.once(event, this.cleanup);
        this.process.stdout.pipe(options.input);

        options.input.once("readable", () => { this.parameters.readable = true; });
    };

    /**
     * @description Создаем поток
     * @param options {object} Параметры для создания
     * @public
     */
    public constructor(options: { path: string; filters?: string; seek?: number; chunkSize: number; }) {
        if (options.chunkSize > 0) this._duration["editFrame"] = 20 * options.chunkSize;
        if (options.seek > 0) this._duration["current"] = options.seek;

        this.create = options;
        this.input = {
            input: this.stream,
            events: ["end", "close", "error"]
        };
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        setImmediate(() => {
            for (const stream of this.streams) {
                if (stream instanceof Process) stream.cleanup();
                else {
                    stream?.destroy();
                    stream?.removeAllListeners();
                }

                this.streams.shift();
            }
        });

        this._duration = null;
        for (let item of Object.keys(this.parameters)) this.parameters[item] = null;
    };
}


/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 */
export class Process {
    private readonly _temp = {
        process: null as ChildProcessWithoutNullStreams
    };
    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @return ChildProcessWithoutNullStreams
     * @public
     */
    public get process() { return this._temp.process; };

    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() { return this?.process?.stdout; };

    /**
     * @description Зарезервирован для чтения команд пользователя или входных данных.
     * @return internal.Writable
     * @public
     */
    public get stdin() { return this?.process?.stdin; };

    /**
     * @description Зарезервирован для вывода диагностических и отладочных сообщений в текстовом виде.
     * @return internal.Readable
     * @public
     */
    public get stderr() { return this?.process?.stderr; };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = "ffmpeg") {
        this._temp.process = spawn(name, args);
        ["end", "close", "error"].forEach((event) => this.process.once(event, this.cleanup));
    };

    /**
     * @description Удаляем FFmpeg
     * @private
     */
    public cleanup = () => {
        for (const std of [this.stdout, this.stdin, this.stderr]) {
            try {
                std?.destroy();
                std?.removeAllListeners();
            } catch {}
        }

        if (!this.process?.killed) this.process?.kill();
        for (let item of Object.keys(this._temp)) this._temp[item] = null;
    };
}