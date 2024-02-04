import {Transform, TransformOptions} from "node:stream";
import {db} from "@Client/db";

const charCode = (x: string) => x.charCodeAt(0);
export const SupportOpusLibs = [
    [//https://www.npmjs.com/package/opusscript
        "opusscript",
        (setup = [48000, 2, 2049]) => new (require("opusscript"))(...setup)
    ],
    [//https://www.npmjs.com/package/@discordjs/opus
        "@discordjs/opus",
        (setup = [48000, 2]) => new (require("@discordjs/opus").OpusEncoder)(...setup)
    ],
    [//https://www.npmjs.com/package/mediaplex
        "mediaplex",
        (setup = [48000, 2]) => new (require("mediaplex").OpusEncoder)(...setup)
    ],
    [//https://www.npmjs.com/package/@evan/opus
        "@evan/opus",
        (setup = { channels: 2, sample_rate: 48000 }) => new (require("@evan/opus").Encoder)(setup)
    ]
];
let SelectedOpusLib = null;

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 */
export class OpusEncoder extends Transform {
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

            if (this._temp.buffer) {
                if (header.equals(this._encode.OPUS_TAGS)) this.emit('tags', segment);
                else if (this._temp.bitstream === bitstream) this.push(segment);
            } else if (header.equals(this._encode.OPUS_HEAD)) {
                this.emit('head', segment);
                this._temp.buffer = segment;
                this._temp.bitstream = bitstream;
            } else this.emit('unknownSegment', segment);

            start += size;
        }

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
            if (!SelectedOpusLib) {
                const lib = SupportOpusLibs.find((item) => item[0] === db.AudioOptions.opus);
                SelectedOpusLib = lib[1];
            }

            //Подключаем opus library
            this._encode.encoder = SelectedOpusLib();
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

            if (this._encode.encoder) {
                this.push(packet); n++;
            } else {
                if (packet) chunk = packet;
                else break;
            }
        }

        if (n > 0) this._temp.buffer = this._temp.buffer.subarray(n * this._temp.required);
        return done();
    };

    /**
     * @description Удаляем данные по завершению
     * @private
     */
    _destroy() {
        try {
            if (this._encode.encoder && "delete" in this._encode.encoder) this._encode.encoder.delete();
        } catch {}

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
    protected constructor(seek: number, frame: number) {
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