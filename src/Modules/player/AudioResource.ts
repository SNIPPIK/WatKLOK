import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {OpusEncoder} from "@watklok/voice/utils/Opus";

/**
 * @author SNIPPIK
 * @description Конвертирует аудио в нужный формат
 * @class AudioResource
 */
export class AudioResource {
    private readonly _streams = {
        opus:    new OpusEncoder(),
        process: null as Process
    };
    private readonly _temp = {
        readable: false,
        frame: 20,
        frames: 0
    };
    /**
     * @description Начато ли чтение потока
     * @return boolean
     * @public
     */
    public get readable() { return this._temp.readable; };

    /**
     * @description Поток
     * @return OpusEncoder
     * @public
     */
    public get stream() { return this._streams.opus; };

    /**
     * @description Выдаем фрагмент потока
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        const packet = this._streams.opus.read();

        if (packet) this._temp.frames++;
        return packet;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @return number
     * @public
     */
    public get duration() {
        const duration = ((this._temp.frames * this._temp.frame) / 1e3).toFixed(0);

        return parseInt(duration);
    };

    /**
     * @description Создаем поток
     * @param options {object} Параметры для создания
     * @public
     */
    public constructor(options: { path: string; filters?: string; seek?: number; chunkSize: number; }) {
        const {seek, path} = options;

        if (options.chunkSize > 0) this._temp.frame = 20 * options.chunkSize;
        if (seek > 0) this._temp.frames = (seek * 1e3) / this._temp.frame;

        //Слушаем OpusEncoder
        ["end", "close", "error"].forEach((event) => this.stream.once(event, this.cleanup));
        this.stream.once("readable", () => { this._temp.readable = true; });

        //Запускаем процесс FFmpeg и подключаем его к OpusEncoder'у
        const urls = path.split(":|");
        this._streams.process = new Process(["-vn", "-loglevel", "panic",
            ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
            "-ss", `${seek ?? 0}`, "-i", urls[1],
            ...(options.filters ? ["-af", options.filters]: []),
            "-f", `${OpusEncoder.lib.ffmpeg}`, "pipe:1"
        ]);
        this._streams.process.stderr.once("error", (err) => this.stream.emit("error", err));
        this._streams.process.stdout.pipe(this.stream);
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        for (let [key, value] of Object.entries(this._streams)) {
            if (value instanceof Process) value.cleanup();
            else {
                value?.destroy();
                value?.removeAllListeners();
            }

            this._streams[key] = null;
        }

        for (let item of Object.keys(this._temp)) this._temp[item] = null;
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