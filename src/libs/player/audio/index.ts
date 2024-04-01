import {ChildProcessWithoutNullStreams, spawn, spawnSync} from "child_process";
import {OpusEncoder} from "@lib/voice/utils/Opus";
import * as path from "node:path";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg/avconv
 */
const checkFFmpeg = () => {
    const names = [`${env.get("cached.dir")}/FFmpeg/ffmpeg`, env.get("cached.dir"), env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    for (const name of ["ffmpeg", "avconv", ...names]) {
        try {
            const result = spawnSync(name, ['-h'], {windowsHide: true});
            if (result.error) throw result.error;
            env.set("ffmpeg.path", name);
            return;
        } catch {}
    }

    throw Error("FFmpeg/avconv not found!");
};
checkFFmpeg();

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
        path:    null as string,
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
        const urls = options.path.split(":|");

        this._streams.push(
            new Process(["-vn",  "-loglevel", "panic",
                //Добавляем ссылки или путь до файла
                ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),

                //Надо ли сделать пропуск
                "-ss", `${options.seek ?? 0}`, "-i", urls[1],

                //Добавляем фильтры
                ...(options.filters ? ["-af", options.filters] : []),

                //Добавляем формат аудио
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
        for (const event of options.events) options.input.once(event, this.cleanup);
        options.input.once("readable", () => { this._readable = true; });

        this.process.stdout.pipe(options.input);
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param options - Настройки кодировщика
     */
    public constructor(options: SeekStream["_options"]) {
        if (options.chunk > 0) this._options.chunk = 20 * options.chunk;
        if (options.seek > 0) this._options.seek = (options.seek * 1e3) / this._options.chunk;

        this.ffmpeg = options;
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
            for (const stream of this._streams) {
                if (stream instanceof Process) stream.cleanup();
                else {
                    stream?.destroy();
                    stream?.removeAllListeners();
                }

                this._streams.shift();
            }
        });
        for (let item of Object.keys(this._options)) this._options[item] = null;
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
     * @description Зарезервирован для чтения команд пользователя или входных данных
     * @return internal.Writable
     * @public
     */
    public get stdin() { return this?.process?.stdin; };

    /**
     * @description Зарезервирован для вывода диагностических и отладочных сообщений в текстовом виде
     * @return internal.Readable
     * @public
     */
    public get stderr() { return this?.process?.stderr; };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = env.get("ffmpeg.path")) {
        this._process = spawn(name, args, {windowsHide: true, shell: false});
        ["end", "close", "error"].forEach((event) => this.process.once(event, this.cleanup));
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public cleanup = () => {
        if (this._process && !this.process?.killed) this.process?.kill();
        this._process = null;
    };
}