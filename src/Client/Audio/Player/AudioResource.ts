import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {Transform, TransformOptions} from "node:stream";
import {Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";

let Opus_Lib = null;
const charCode = x => x.charCodeAt(0);

/**
 * @author SNIPPIK
 * @description Сохраняет в буфер аудио пакеты
 * @class BufferStream
 * @abstract
 */
abstract class BufferStream {
    private readonly chunks: Array<Buffer> = [];
    private readonly _local = {
        frame: 20,
        frames: 0
    };
    /**
     * @description Создаем класс буфера
     * @param seek {number} Время пропуска
     * @param frame {number} Длительность пакета
     */
    public constructor(seek: number, frame: number) {
        if (frame > 0) this._local.frame = 20 * frame;
        if (seek > 0) this._local.frames = ((seek * 1e3) / frame);
    };

    /**
     * @description Начато ли чтение потока
     * @return boolean
     * @public
     */
    public get readable() {
        return this.chunks.length > 0;
    };

    /**
     * @description Выдаем фрагмент потока
     * @return Buffer
     * @public
     */
    public get packet() {
        const packet = this.chunks.shift();

        if (packet) this._local.frames++;
        return packet;
    };

    /**
     * @description Сохраняем пакет в _local.chunks
     * @param chunk {any} Пакет
     * @protected
     */
    public set packet(chunk) {
        this.chunks.push(chunk);
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
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 */
export class OpusEncoder extends Transform {
    private readonly _temp = {
        buffer: Buffer.alloc(0),
        encoder: null,
        frame: 960
    };
    private readonly _ogg = {
        head: null,
        bitstream: null,

        OGG_HEADER: Buffer.from([...'OggS'].map(charCode)),
        OPUS_HEAD: Buffer.from([...'OpusHead'].map(charCode)),
        OPUS_TAGS: Buffer.from([...'OpusTags'].map(charCode))
    };

    public constructor(options: TransformOptions = {autoDestroy: true, objectMode: true}) {
        super(Object.assign({ readableObjectMode: true }, options));

        //ЕСли была найдена opus library
        if (db.AudioOptions.opus) {
            //Если нет сохраненной opus library
            if (!Opus_Lib) {
                const lib = require(db.AudioOptions.opus);

                if ("OpusEncoder" in lib) Opus_Lib = lib.OpusEncoder;
                else Opus_Lib = lib;
            }

            //Подключаем opus library
            this._temp.encoder = new Opus_Lib(48e3, 2, 2049);
        }
    };

    /**
     * @description Размер буфера
     * @private
     */
    private get required() { return this._temp.frame * 2 * 2; };

    /**
     * @description Декодирование в opus
     * @private
     */
    private encode = (chunk: Buffer) => {
        if (this._temp.encoder) return this._temp.encoder.encode(chunk, this._temp.frame);

        if (chunk.length < 26) return false;
        else if (!chunk.subarray(0, 4).equals(this._ogg.OGG_HEADER)) {
            this.emit("error", Error(`capture_pattern is not ${this._ogg.OGG_HEADER}`));
            return false;
        } else if (chunk.readUInt8(4) !== 0) {
            this.emit("error", Error(`stream_structure_version is not ${0}`));
            return false;
        }
        const pageSegments = chunk.readUInt8(26);
        let start = 27 + pageSegments, sizes = [], totalSize = 0;

        if (chunk.length < 27 || chunk.length < 27 + pageSegments) return false;

        const table = chunk.subarray(27, 27 + pageSegments);
        const bitstream = chunk.readUInt32BE(14);

        for (let i = 0; i < pageSegments;) {
            let size = 0, x = 255;

            while (x === 255) {
                if (i >= table.length) return false;
                x = table.readUInt8(i); i++; size += x;
            }

            sizes.push(size);
            totalSize += size;
        }

        if (chunk.length < 27 + pageSegments + totalSize) return false;

        for (const size of sizes) {
            const segment = chunk.subarray(start, start + size);
            const header = segment.subarray(0, 8);

            if (this._ogg.head) {
                if (header.equals(this._ogg.OPUS_TAGS)) this.emit('tags', segment);
                else if (this._ogg.bitstream === bitstream) this.push(segment);
            } else if (header.equals(this._ogg.OPUS_HEAD)) {
                this.emit('head', segment);
                this._ogg.head = segment;
                this._ogg.bitstream = bitstream;
            } else this.emit('unknownSegment', segment);

            start += size;
        }

        return chunk.subarray(start);
    };

    _transform(chunk: Buffer, _: any, done: () => any) {
        let n = 0, buffer = () => chunk;

        if (this._temp.encoder) {
            this._temp.buffer = Buffer.concat([this._temp.buffer, chunk]);
            buffer = () => this._temp.buffer.subarray(n * this.required, (n + 1) * this.required);
        }

        while (this._temp.encoder ? this._temp.buffer.length >= this.required * (n + 1) : chunk) {
            const packet = this.encode(buffer());

            if (this._temp.encoder) {
                this.push(packet); n++;
            } else {
                if (packet) chunk = packet;
                else break;
            }
        }

        if (n > 0) this._temp.buffer = this._temp.buffer.subarray(n * this.required);
        return done();
    };

    _destroy() {
        try {
            if (this._temp.encoder && "delete" in this._temp.encoder) this._temp.encoder.delete();
        } catch {}

        for (let name of Object.keys(this._temp)) this._temp[name] = null;
        for (let name of Object.keys(this._ogg)) this._ogg[name] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует аудио в нужный формат
 * @class AudioResource
 */
export class AudioResource extends BufferStream {
    private readonly _stream = {
        process: null as Process,
        opus: new OpusEncoder()
    };
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
        this._stream.process = new Process(["-vn", "-loglevel", "panic",
            ...(urls[0] === "link" ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
            "-ss", `${seek ?? 0}`, "-i", urls[1], "-af", filters, "-f", `${db.AudioOptions.opus ? "s16le" : "opus"}`, "-b:a", `${db.AudioOptions.bitrate}`, "pipe:1"
        ]);

        //Слушаем декодер
        ["end", "close", "error"].forEach((event) => this.stream.once(event, this.cleanup));
        this._stream.process.stderr.once("error", (err) => this.stream.emit("error", err));

        this._stream.process.stdout.pipe(this._stream.opus);
        this._stream.opus.on("data", chunk => {
            if (chunk) this.packet = chunk;
        });
    };

    /**
     * @description Поток
     * @return opus.Encoder | opus.OggDemuxer
     * @public
     */
    public get stream() {
        return this._stream.opus;
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        for (let [key, value] of Object.entries(this._stream)) {
            if (value) {
                if (value instanceof Process) {
                    value.process.emit("close");
                    value.stdout.removeAllListeners();
                } else {
                    value?.destroy();
                    value?.removeAllListeners();
                }
                this._stream[key] = null;
            }
        }
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
        const realFilters = [`volume=${db.AudioOptions.volume / 100}`]; let speed = 0;

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
        if (db.AudioOptions.fade > 0) realFilters.push(`afade=t=in:st=0:d=${db.AudioOptions.fade}`);

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