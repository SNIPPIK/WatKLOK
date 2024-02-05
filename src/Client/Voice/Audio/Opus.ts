import {Transform, TransformOptions} from "node:stream";
import {db} from "@Client/db";

export const OpusLibs = [
    [//https://www.npmjs.com/package/opusscript
        "opusscript", [48000, 2, 2049],
        (mod = require) => mod("opusscript")
    ],
    [//https://www.npmjs.com/package/@discordjs/opus
        "@discordjs/opus", [48000, 2],
        (mod = require) => mod("@discordjs/opus").OpusEncoder
    ],
    [//https://www.npmjs.com/package/mediaplex
        "mediaplex", [48000, 2],
        (mod = require) => mod("mediaplex").OpusEncoder
    ],
    [//https://www.npmjs.com/package/@evan/opus
        "@evan/opus", [{ channels: 2, sample_rate: 48000 }],
        (mod = require) => mod("@evan/opus").Encoder
    ]
], charCode = (x: string) => x.charCodeAt(0);
let Opus = [];

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 */
class OpusEncoder extends Transform {
    private readonly _encode = {
        encoder: null,

        OGG_HEADER: Buffer.from([...'OggS'].map(charCode)),
        OPUS_HEAD: Buffer.from([...'OpusHead'].map(charCode)),
        OPUS_TAGS: Buffer.from([...'OpusTags'].map(charCode))
    };
    private readonly _temp = {
        required: 960 * 2 * 2,
        buffer: null    as Buffer,
        bitstream: null as number
    };
    /**
     * @description Декодирование в opus
     * @private
     */
    private encode = (chunk: Buffer) => {
        if (this._encode.encoder) return this._encode.encoder.encode(chunk, 960);

        if (chunk.length < 26) return false;
        else if (!chunk.subarray(0, 4).equals(this._encode.OGG_HEADER)) {
            this.emit("error", Error(`capture_pattern is not ${this._encode.OGG_HEADER}`));
            return false;
        } else if (chunk.readUInt8(4) !== 0) {
            this.emit("error", Error(`stream_structure_version is not ${0}`));
            return false;
        }

        const pageSegments = chunk.readUInt8(26);
        if (chunk.length < 27 || chunk.length < 27 + pageSegments) return false;

        const table = chunk.subarray(27, 27 + pageSegments);
        let sizes = [], totalSize = 0;

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

        const bitstream = chunk.readUInt32BE(14); let start = 27 + pageSegments;

        //Ищем нужный пакет, тот самый пакет opus
        for (const size of sizes) {
            const segment = chunk.subarray(start, start + size);
            const header = segment.subarray(0, 8);

            if (this._temp.bitstream === bitstream) this.push(segment);
            else if (header.equals(this._encode.OPUS_HEAD)) this._temp.bitstream = bitstream;

            start += size;
        }

        //Выдаем следующие данные
        return chunk.subarray(start);
    };

    /**
     * @description
     * @param options
     */
    public constructor(options: TransformOptions = {autoDestroy: true, objectMode: true}) {
        super(Object.assign({ readableObjectMode: true }, options));

        //Если была найдена opus library
        if (db.AudioOptions.opus) {
            //Если нет сохраненной opus library
            if (Opus.length === 0) {
                const lib = OpusLibs.find((item) => item[0] === db.AudioOptions.opus);

                Opus.push(lib[1], (lib[2] as any)());
            }

            //Подключаем opus library
            this._encode.encoder = new Opus[1](...Opus[0]);
            this._temp.buffer = Buffer.alloc(0);
        }
    };

    /**
     * @description Модифицируем текущий поток
     * @private
     */
    _transform(chunk: Buffer, _: any, done: () => any) {
        let n = 0, buffer = () => chunk;

        if (this._encode.encoder) {
            this._temp.buffer = Buffer.concat([this._temp.buffer, chunk]);
            buffer = () => this._temp.buffer.subarray(n * this._temp.required, (n + 1) * this._temp.required);
        }

        while (this._encode.encoder ? this._temp.buffer.length >= this._temp.required * (n + 1) : chunk) {
            const packet = this.encode(buffer());

            if (!this._encode.encoder) {
                if (packet) chunk = packet;
                else break;
            } else {
                this.push(packet); n++
            }
        }

        if (n > 0) this._temp.buffer = this._temp.buffer.subarray(n * this._temp.required);
        return done();
    };

    /**
     * @description Удаляем данные по завершению
     * @private
     */
    _final(cb: () => void) {
        this.destroy();
        cb();
    };

    /**
     * @description Удаляем данные по завершению
     * @private
     */
    _destroy() {
        if (typeof this._encode.encoder?.delete === 'function') this._encode.encoder!.delete!();

        for (let name of Object.keys(this._temp)) this._temp[name] = null;
        for (let name of Object.keys(this._encode)) this._encode[name] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Сохраняет в буфер аудио пакеты
 * @class BufferStream
 * @abstract
 */
export abstract class BufferStream {
    private readonly _local = {
        opus: new OpusEncoder(),

        chunks: [] as Array<Buffer>,
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

        this._local.opus.on("data", chunk => {
            if (chunk) this._local.chunks.push(chunk);
        });
    };

    /**
     * @description Начато ли чтение потока
     * @return boolean
     * @public
     */
    public get readable() {
        return this._local.chunks.length > 0;
    };

    /**
     * @description Выдаем фрагмент потока
     * @return Buffer
     * @public
     */
    public get packet() {
        const packet = this._local.chunks.shift();

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