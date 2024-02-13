import {Transform, TransformOptions} from "node:stream";

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

const loadModule = ( modules: typeof OpusLibs = OpusLibs ) => {
    for (const obj of modules) {
        try {
            (obj[3] as () => any)();

            Opus.push(obj[0], obj[1], (obj[2] as any)());
        } catch {}
    }
};
loadModule();

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 * @extends Transform
 */
export class OpusEncoder extends Transform {
    private readonly _encode = {
        encoder: null,

        OGG_HEADER: Buffer.from([...'OggS'].map(charCode)),
        OPUS_HEAD: Buffer.from([...'OpusHead'].map(charCode)),
        OPUS_TAGS: Buffer.from([...'OpusTags'].map(charCode))
    };
    private readonly _temp = {
        remaining: null as Buffer,
        required: 960 * 2 * 2,
        buffer: null    as Buffer,
        bitstream: null as number
    };
    /**
     * @description Декодирование фрагмента в opus
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

        //Выдаем следующие данные
        return chunk.subarray(start);
    };

    /**
     * @description Название библиотеки и тип аудио для ffmpeg
     * @return {name: string, ffmpeg: string}
     * @public
     */
    public static get lib(): {name: string, ffmpeg: string} {
        if (Opus.length > 0) return { name: Opus[0], ffmpeg: "s16le" };
        return { name: "Native/Opus", ffmpeg: "opus" };
    };

    /**
     * @description Запуск класса расшифровки в opus
     * @param options
     * @public
     */
    public constructor(options: TransformOptions = {autoDestroy: true, objectMode: true}) {
        super(Object.assign({ readableObjectMode: true }, options));

        //Если была найдена opus library
        if (Opus.length > 0) {
            //Подключаем opus library
            this._encode.encoder = new Opus[2](...Opus[1]);
            this._temp.buffer = Buffer.alloc(0);
        }
    };

    /**
     * @description Модифицируем текущий фрагмент
     * @public
     */
    _transform(chunk: Buffer, _: any, done: () => any) {
        let n = 0, buffer = () => chunk;

        if (this._encode.encoder) {
            this._temp.buffer = Buffer.concat([this._temp.buffer, chunk]);
            buffer = () => this._temp.buffer.subarray(n * this._temp.required, (n + 1) * this._temp.required);
        }

        if (this._temp.remaining) {
            chunk = Buffer.concat([this._temp.remaining, chunk]);
            this._temp.remaining = null;
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

        if (!this._encode.encoder) this._temp.remaining = chunk;
        if (n > 0) this._temp.buffer = this._temp.buffer.subarray(n * this._temp.required);
        return done();
    };

    /**
     * @description Удаляем данные по окончанию
     * @public
     */
    _final(cb: () => void) {
        this.destroy();
        cb();
    };

    /**
     * @description Удаляем данные по завершению
     * @public
     */
    _destroy() {
        if (typeof this._encode.encoder?.delete === 'function') this._encode.encoder!.delete!();

        for (let name of Object.keys(this._temp)) this._temp[name] = null;
        for (let name of Object.keys(this._encode)) this._encode[name] = null;
    };
}