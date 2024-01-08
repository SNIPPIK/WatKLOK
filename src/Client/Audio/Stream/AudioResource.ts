import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {opus} from "prism-media";
import {db, Logger} from "@src";
import {env} from "@env"

const volume = parseInt(env.get("audio.volume"));
const AudioFade = parseInt(env.get("audio.fade"));
const bitrate = env.get("audio.bitrate");
/**
 *    ____  _____  _    _  _____
 *   / __ \|  __ \| |  | |/ ____|
 *  | |  | | |__) | |  | | (___
 *  | |  | |  ___/| |  | |\___ \
 *  | |__| | |    | |__| |____) |
 *   \____/|_|     \____/|_____/
 * @author SNIPPIK
 * @description Создаем поток для плеера {AudioPlayer by SNIPPIK}
 * @class AudioResource
 */
export class AudioResource {
    private readonly _defaultArgs: string[] = ["-vn", "-loglevel", "panic"];
    private readonly _process: Process;
    private readonly _frame = {
        size: 20,
        sizes: 0
    };
    /**
     * @author SNIPPIK
     * @description Подключаем opusDemuxer
     * @class Opus
     * @private
     */
    private readonly _decoder = new class Opus {
        public readonly _ogg = new opus.OggDemuxer({ autoDestroy: true, objectMode: true });
        public _readable: boolean = false;
        public _ended: boolean = false;
        /**
         * @description Подключаем процесс к указанному классу
         * @param process {Process} Класс потока
         */
        public set pipe(process: Process) {
            process.stderr.once("error", (err) => this._ogg.emit("error", err));
            this._ogg.once("readable", () => { this._readable = true; });

            process.stdout.pipe(this._ogg);
        };
    };

    /**
     * @description Используется для проверки можно брать пакеты из потока
     * @return boolean
     * @public
     */
    public get readable() { return this._decoder._readable; }

    /**
     * @description Используется для проверки удален ли поток
     * @return boolean
     * @public
     */
    public get ended() { return this._decoder._ended; }

    /**
     * @description Получаем пакет в размере this._frame ms
     * @return Buffer
     * @public
     */
    public get packet(): Buffer | null {
        const packet = this?._decoder._ogg.read();

        //Если есть пакет, то добавляем его во временную базу
        if (packet) this._frame.sizes++;

        //Если нет пакетов, то удаляем поток
        else if (!packet) this._cleanup();

        return packet;
    };

    /**
     * @description Получаем поток
     * @return BufferedStream
     * @public
     */
    public get stream() { return this._decoder._ogg; };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @return number
     * @public
     */
    public get duration(): number {
        const duration = ((this._frame.sizes * this._frame.size) / 1e3).toFixed(0);

        return parseInt(duration);
    };

    /**
     * @description Инициируем класс
     * @param options
     * @public
     */
    public constructor(options: { path: string; filters?: Filter[]; seek?: number; }) {
        const { filters, speed} = Filters.getParameters(options?.filters ?? []);

        if (speed > 0) this._frame.size = 20 * speed;
        if (options.seek > 0) this._frame.sizes = (options.seek * 1e3) / this._frame.size;

        //Слушаем декодер
        ["end", "close", "error"].forEach((event) => this._decoder._ogg.once(event, () => {
            this._process.process.emit("close");
            this._cleanup();
        }));


        //Запускаем процесс FFmpeg и подключаем его к декодеру
        const urls = options.path.split(":|");

        if (urls[0] === "link") this._defaultArgs.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
        this._decoder.pipe = this._process = new Process([...this._defaultArgs, "-ss", `${options.seek ?? 0}`,
            "-i", urls[1], "-af", filters, "-f", "opus", "-b:a", `${bitrate}`, "pipe:1"
        ]);
    };

    /**
     * @description Удаляем данные из класса
     * @return void
     * @public
     */
    private _cleanup = (): void => {
        if (this._decoder._ogg) {
            this._decoder._ogg.emit("close");
            this._decoder._readable = null;
            this._decoder._ended = null;
        }

        if (this._process) this._process.process.emit("close");
    };
}



/**
 *   ______ ______
 *  |  ____|  ____|
 *  | |__  | |__ _ __ ___  _ __   ___  __ _
 *  |  __| |  __| '_ ` _ \| '_ \ / _ \/ _` |
 *  | |    | |  | | | | | | |_) |  __/ (_| |
 *  |_|    |_|  |_| |_| |_| .__/ \___|\__, |
 *                        | |          __/ |
 *                        |_|         |___/
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

    public constructor(args: string[], name: string = env.get("ffmpeg.path")) {
        this._process = spawn(name, args);
        Logger.debug(`[${name}] has spawning, args: ${args.length}`);

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
 *   ______   _   _   _
 *  |  ____| (_) | | | |
 *  | |__     _  | | | |_    ___   _ __   ___
 *  |  __|   | | | | | __|  / _ \ | '__| / __|
 *  | |      | | | | | |_  |  __/ | |    \__ \
 *  |_|      |_| |_|  \__|  \___| |_|    |___/
 * @author SNIPPIK
 * @class Filters
 */
export const Filters = new class {
    /**
     * @description Ищем Filter в Array<Filter>
     * @param name {string} Имя фильтра
     * @return Filter
     */
    public get = (name: string): Filter => db.music.filters.find((fn) => fn.names.includes(name));

    /**
     * @description Получаем параметры фильтров ит готовые фильтры для FFmpeg
     * @param filters {Filter[]} Фильтры
     * @return object
     */
    public getParameters = (filters: Filter[]) => {
        const realFilters = [`volume=${volume / 100}`]; let speed = 0;

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
        if (AudioFade > 0) realFilters.push(`afade=t=in:st=0:d=${AudioFade}`);

        return { filters: realFilters.join(","), speed }
    }
}

/**
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