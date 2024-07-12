import {Transform, TransformOptions} from "node:stream";

/**
 * @author SNIPPIK
 * @description Доступные библиотеки для включения
 */
const OpusLibs = {
    "opusscript": (lib: any): Methods => {
        return { args: [48000, 2, 2049], encoder: lib }
    },
    "mediaplex": (lib: any): Methods => {
        return { args: [48000, 2], encoder: lib.OpusEncoder }
    },
    "@evan/opus": (lib: any): Methods => {
        return { args: [{ channels: 2, sample_rate: 48000 }], encoder: lib.Encoder }
    },
    "@discordjs/opus": (lib: any): Methods => {
        return { args: [48000, 2], encoder: lib.OpusEncoder }
    },
}, Opus: Methods = {}, charCode = (x: string) => x.charCodeAt(0);

/**
 * @author SNIPPIK
 * @description Доступный формат для отправки opus пакетов
 */
const bit = 960 * 2 * 2;

/**
 * @author SNIPPIK
 * @description Заголовки для поиска в chuck
 */
const OGG = {
    "OGGs_HEAD": Buffer.from([..."OggS"].map(charCode)),
    "OPUS_HEAD": Buffer.from([..."OpusHead"].map(charCode)),
    "OPUS_TAGS": Buffer.from([..."OpusTags"].map(charCode))
};

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие библиотек Opus
 */
(() => {
    const names = Object.keys(OpusLibs)

    for (const name of names) {
        try {
            const library = require(name);

            Object.assign(Opus, {...OpusLibs[name](library), name});
            delete require.cache[require.resolve(name)];
        } catch {}
    }
})();

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 * @extends Transform
 */
export class OpusEncoder extends Transform {
    private readonly encoder: any = null;
    private readonly _temp = {
        remaining: null as Buffer,
        buffer: null    as Buffer,
        bitstream: null as number
    };
    /**
     * @description Название библиотеки и тип аудио для ffmpeg
     * @return {name: string, ffmpeg: string}
     * @public
     */
    public static get lib(): {name: string, ffmpeg: string} {
        if (Opus?.name) return { name: Opus.name, ffmpeg: "s16le" };
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
        if (Opus?.name) {
            //Подключаем opus library
            this.encoder = new Opus.encoder(...Opus.args);
            this._temp.buffer = Buffer.alloc(0);
        }
    };

    /**
     * @description Декодирование фрагмента в opus
     * @private
     */
    private encode = (chunk: Buffer) => {
        if (this.encoder) return this.encoder.encode(chunk, 960);

        if (chunk.length < 26) return false;
        else if (!chunk.subarray(0, 4).equals(OGG.OGGs_HEAD)) {
            this.emit("error", Error(`capture_pattern is not ${OGG.OGGs_HEAD}`));
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
                if (header.equals(OGG.OPUS_TAGS)) this.emit("tags", segment);
                else if (this._temp.bitstream === bitstream) this.push(segment);
            } else if (header.equals(OGG.OPUS_HEAD)) {
                this.emit("head", segment);
                this._temp.buffer = segment;
                this._temp.bitstream = bitstream;
            } else this.emit("unknownSegment", segment);

            start += size;
        }

        //Выдаем следующие данные
        return chunk.subarray(start);
    };

    /**
     * @description Модифицируем текущий фрагмент
     * @public
     */
    _transform = (chunk: Buffer, _: any, done: () => any) => {
        let n = 0, buffer = () => chunk;

        if (!this.encoder) setImmediate(() => this._temp.remaining = chunk);
        else {
            this._temp.buffer = Buffer.concat([this._temp.buffer, chunk]);
            buffer = () => this._temp.buffer.subarray(n * bit, (n + 1) * bit);
        }

        if (this._temp.remaining) {
            chunk = Buffer.concat([this._temp.remaining, chunk]);
            this._temp.remaining = null;
        }

        while (this.encoder ? this._temp.buffer.length >= bit * (n + 1) : chunk) {
            const packet = this.encode(buffer());

            if (!this.encoder) {
                if (packet) chunk = packet;
                else break;
            } else this.push(packet); n++
        }

        if (n > 0) this._temp.buffer = this._temp.buffer.subarray(n * bit);
        return done();
    };

    /**
     * @description Удаляем данные по окончанию
     * @public
     */
    _final = (cb: () => void) => {
        this.destroy();
        cb();
    };

    /**
     * @description Удаляем данные по завершению
     * @public
     */
    _destroy = () => {
        if (typeof this.encoder?.delete === "function") this.encoder!.delete!();
        // @ts-ignore
        this["encoder"] = null;

        for (let name of Object.keys(this._temp)) this._temp[name] = null;
    };
}

/**
 * @description Выдаваемы методы для работы opus encoder
 */
interface Methods {
    //Имя библиотеки
    name?: string;

    //Аргументы для запуска
    args?: any[];

    //Класс для расшифровки
    encoder?: any;
}