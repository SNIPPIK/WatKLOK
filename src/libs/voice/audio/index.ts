import {ChildProcessWithoutNullStreams, spawn, spawnSync} from "node:child_process";
import {OpusEncoder} from "@lib/voice/audio/utils/Opus";
import * as path from "node:path";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Конвертирует аудио в нужный формат
 * @class SeekStream
 */
export class SeekStream {
    /**
     * @description Временное хранилище для потоков
     * @private
     */
    private readonly _streams: (Process | OpusEncoder)[] = [
        new OpusEncoder({
            highWaterMark: 5 * 1000 * 1000,
            readableObjectMode: true
        })
    ];

    /**
     * @description Данные для запуска процесса буферизации
     * @private
     */
    private readonly _options = {
        filters: null as string,
        seek:    0 as number,
        chunk:   20
    };

    /**
     * @description Можно ли читать поток
     * @private
     */
    private _readable = false;

    /**
     * @description Можно ли читать поток
     * @default true - Всегда можно читать поток, если поток еще не был загружен то отправляем пустышки
     * @return boolean
     * @public
     */
    public get readable() { return this._readable; };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        const packet = this.stream.read();
        if (packet) this._options.seek++;

        return packet;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @public
     */
    public get duration() {
        const duration = ((this._options.seek * this._options.chunk) / 1e3).toFixed(0);
        return parseInt(duration);
    };

    /**
     * @description Получаем OpusEncoder
     * @return OpusEncoder
     * @public
     */
    public get stream() { return this._streams.at(0) as OpusEncoder; };

    /**
     * @description Получаем Process
     * @return Process
     * @public
     */
    public get process() { return this._streams.at(1) as Process; };

    /**
     * @description Задаем параметры запуска ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set ffmpeg(options: {path: string, seek?: number; filters?: string}) {
        const [type, file] = options.path.split(":|");

        this._streams.push(
            new Process(["-vn",  "-loglevel", "panic",
                ...(type === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
                "-ss", `${options.seek ?? 0}`, "-i", file,
                ...(options.filters ? ["-af", options.filters] : []),
                "-f", `${OpusEncoder.lib.ffmpeg}`, "pipe:1"
            ])
        );
    };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set input(options: {input: NodeJS.ReadWriteStream, events: string[]}) {
        for (const event of options.events) options.input.once(event, this.destroy);
        options.input.once("readable", () => { this._readable = true; });

        this.process.stdout.pipe(options.input);
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param options - Настройки кодировщика
     * @public
     */
    public constructor(options: {path: string, seek?: number; filters?: string; chunk: number}) {
        if (options.chunk > 0) this._options.chunk = 20 * options.chunk;
        if (options.seek > 0) this._options.seek = (options.seek * 1e3) / this._options.chunk;

        this.ffmpeg = options;
        this.input = {
            input: this.stream as any,
            events: ["end", "close", "error"]
        };
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        setImmediate(() => {
            for (const stream of this._streams) {
                if (stream instanceof Process) stream.destroy();
                else {
                    stream?.destroy();
                    stream.end();
                }
            }

            this._streams.splice(0, this._streams.length);
        });

        Object.keys(this._options).forEach(key => this._options[key] = null);
        this._readable = null;
    };
}

/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 */
export class Process {
    /**
     * @description Процесс запущенный через spawn
     * @private
     */
    private _process: ChildProcessWithoutNullStreams = null;

    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @return ChildProcessWithoutNullStreams
     * @public
     */
    public get process() { return this._process; }

    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() { return this?.process?.stdout; };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = env.get("ffmpeg.path")) {
        this._process = spawn(name, args, {shell: false});
        ["end", "close", "error"].forEach((event) => this.process.once(event, this.destroy));
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public destroy = () => {
        if (this._process && !this.process?.killed) this.process?.kill();
        this._process = null;
    };
}

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg/avconv
 */
(() => {
    const names = [`${env.get("cached.dir")}/FFmpeg/ffmpeg`, env.get("cached.dir"), env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    for (const name of [...names, "ffmpeg", "avconv"]) {
        try {
            const result = spawnSync(name, ['-h'], {windowsHide: true});
            if (result.error) continue;
            return env.set("ffmpeg.path", name);
        } catch {}
    }

    throw Error("[WCritical]: FFmpeg/avconv not found!");
})();