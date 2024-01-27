import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {opus} from "prism-media";
import {Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env"

const volume = parseInt(env.get("audio.volume"));
const AudioFade = parseInt(env.get("audio.fade"));
const bitrate = env.get("audio.bitrate");

/**
 * @author SNIPPIK
 * @description Загрузчик файлов музыки для прослушивания
 */
export class AudioResource {
    private readonly _local = {
        stream: {
            process:   null as Process,
            ogg: new opus.OggDemuxer({ autoDestroy: true, objectMode: true })
        },
        frame: {
            bufferSize: 20,
            value: 0
        },

        readable: false,
        ended:    false
    };

    /**
     * @description Создаем поток и удаляем старй если он есть
     * @param options {any} Настройки создания потока
     */
   public constructor(options: { path: string; filters?: Filter[]; seek?: number; }) {
       const {seek, path} = options;
        const { filters, speed} = Filters.getParameters(options.filters);

        if (speed > 0) this._local.frame.bufferSize = 20 * speed;
        if (seek > 0) this._local.frame.value = ((seek * 1e3) / this._local.frame.bufferSize);

        //Слушаем декодер
        ["end", "close", "error"].forEach((event) => this.stream.once(event, this.cleanup));

        //Запускаем процесс FFmpeg и подключаем его к декодеру
        const urls = path.split(":|");

        this._local.stream.process = new Process(["-vn", "-loglevel", "panic",
            ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
            "-ss", `${seek}`, "-i", urls[1], "-af", filters, "-f", "opus", "-b:a", `${bitrate}`, "pipe:1"
        ]);

        this._local.stream.ogg.once("readable", () => { this._local.readable = true; });
        this._local.stream.process.stderr.once("error", (err) => this.stream.emit("error", err));
        this._local.stream.process.stdout.pipe(this._local.stream.ogg);
    };

    /**
     * @description Поток
     */
    public get stream() { return this._local.stream.ogg; };

    /**
     * @description Начато ли чтение потока
     */
    public get readable() { return this._local.readable; };

    /**
     * @description Выдаем фрагмент потока
     */
    public get packet() {
        const packet = this.stream?.read();

        if (packet) this._local.frame.value++;
        else this.cleanup(); //Если нет пакетов, то удаляем поток

        return packet;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @return number
     * @public
     */
    public get duration(): number {
        const duration = ((this._local.frame.value * this._local.frame.bufferSize) / 1e3).toFixed(0);

         return parseInt(duration);
    };

    /**
     * @description Удаляем ненужные данные
     */
    public cleanup = () => {
        for (let [key, value] of Object.entries(this._local.stream)) {
            if (value) {
                if (value instanceof Process) {
                    value.process.emit("close");
                    value.stdout.removeAllListeners();
                } else {
                    value?.destroy();
                    value?.removeAllListeners();
                }
                this._local.stream[key] = null;
            }
        }

        this._local.readable = null;
        this._local.ended = null;
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
        Logger.log("DEBUG", `[${name}] has spawning, args: ${args.length}`);

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
    public get = (name: string): Filter => db.filters.find((fn) => fn.names.includes(name));

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