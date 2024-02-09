import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {OpusEncoder} from "@watklok/opus";
/**
 * @author SNIPPIK
 * @description Сохраняет в буфер аудио пакеты
 * @class BufferStream
 * @abstract
 */
export abstract class BufferStream {
    private readonly _local = {
        opus: new OpusEncoder(),
        readable: false,
        frame: 20,
        frames: 0
    };

    /**
     * @description Создаем класс буфера
     * @param seek {number} Время пропуска
     * @param frame {number} Длительность пакета
     */
    protected constructor(seek: number, frame: number) {
        if (frame > 0) this._local.frame = 20 * frame;
        if (seek > 0) this._local.frames = ((seek * 1e3) / frame);

        this.stream.once("readable", () => {
            this._local.readable = true;
        })
    };

    /**
     * @description Начато ли чтение потока
     * @return boolean
     * @public
     */
    public get readable() {
        return this._local.readable;
    };

    /**
     * @description Выдаем фрагмент потока
     * @return Buffer
     * @public
     */
    public get packet() {
        const packet = this._local.opus.read();

        if (packet) this._local.frames++;
        return packet;
    };

    /**
     * @description Поток
     * @return OpusEncoder
     * @public
     */
    public get stream() {
        return this._local.opus;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @return number
     * @public
     */
    public get duration() {
        const duration = ((this._local.frames * this._local.frame) / 1e3).toFixed(0);

        return parseInt(duration);
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует аудио в нужный формат
 * @class AudioResource
 */
export class AudioResource extends BufferStream {
    private process: Process;
    /**
     * @description Создаем поток
     * @param options {object} Параметры для создания
     * @public
     */
    public constructor(options: { path: string; filters?: Filter[]; seek?: number; }) {
        const {seek, path} = options;
        const { filters, speed} = Filters.getParameters(options.filters);

        super(seek, speed);

        //Запускаем процесс FFmpeg и подключаем его к декодеру
        const urls = path.split(":|");
        this.process = new Process(["-vn", "-loglevel", "panic",
            ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
            "-ss", `${seek ?? 0}`, "-i", urls[1], "-af", filters, "-f", `${OpusEncoder.lib ? "s16le" : "opus"}`, "pipe:1"
        ]);

        //Слушаем декодер
        ["end", "close", "error"].forEach((event) => this.stream.once(event, this.cleanup));
        this.process.stderr.once("error", (err) => this.stream.emit("error", err));
        this.process.stdout.pipe(this.stream);
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        for (const stream of [this.process, this.stream]) {
            if (stream instanceof Process) {
                stream.process.emit("close");
                stream.stdout.removeAllListeners();

                this.process = null;
            } else {
                stream?.destroy();
                stream?.removeAllListeners();
            }
        }
    };
}

/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 */
export class Process {
    private readonly _process: ChildProcessWithoutNullStreams;
    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() { return this?._process?.stdout; };

    /**
     * @description Зарезервирован для чтения команд пользователя или входных данных.
     * @return internal.Writable
     * @public
     */
    public get stdin() { return this?._process?.stdin; };

    /**
     * @description Зарезервирован для вывода диагностических и отладочных сообщений в текстовом виде.
     * @return internal.Readable
     * @public
     */
    public get stderr() { return this?._process?.stderr; };

    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @return ChildProcessWithoutNullStreams
     * @public
     */
    public get process() { return this._process; };

    public constructor(args: string[], name: string = "ffmpeg") {
        this._process = spawn(name, args);
        this.process.once("close", this._cleanup);
    };

    /**
     * @description Удаляем FFmpeg
     * @private
     */
    private _cleanup = () => {
        if (!this._process?.killed) {
            this.stdout.destroy();
            this.stderr.destroy();
            this.stdin.destroy();

            this._process.kill();
        }
    };
}

/**
 * @author SNIPPIK
 * @class Filters
 */
export const Filters = new class {
    /**
     * @description Получаем параметры фильтров ит готовые фильтры для FFmpeg
     * @param filters {Filter[]} Фильтры
     * @return object
     */
    public getParameters = (filters: Filter[]) => {
        const realFilters = [`volume=1`]; let speed = 0;

        //Проверяем фильтры
        for (const filter of filters) {

            //Если фильтр не требует аргумента
            if (!filter.args) realFilters.push(filter.filter);
            else realFilters.push(filter.filter + filter.user_arg ?? "");

            //Если у фильтра есть модификатор скорости
            if (filter?.speed) {
                if (typeof filter.speed === "number") speed += Number(filter.speed);
                else speed += Number(filters.slice(filters.indexOf(filter) + 1));
            }
        }

        //Надо ли плавное включения треков
        realFilters.push(`afade=t=in:st=0:d=5`);

        return { filters: realFilters.join(","), speed }
    }
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface
 */
export interface Filter {
    //Имена
    names: string[];

    //Описание
    description: string;

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number];

    user_arg: any;

    //Меняется ли скорость
    speed?: null | number;
}