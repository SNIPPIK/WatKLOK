import {Transform} from "stream";

const OGG_PAGE_HEADER_SIZE = 26;
const STREAM_STRUCTURE_VERSION = 0;
const charCode = (x: string) => x.charCodeAt(0);
// @ts-ignore
const OGGs_HEADER = Buffer.from([...'OggS'].map(charCode));
// @ts-ignore
const OPUS_HEAD = Buffer.from([...'OpusHead'].map(charCode));
// @ts-ignore
const OPUS_TAGS = Buffer.from([...'OpusTags'].map(charCode));

type TransformDone = (error?: Error | null) => void;

/**
 * @description Декодирует из ogg/opus в чистый opus
 * @author prism-media
 */
export class OggDemuxer extends Transform {
    _HeadSegment: boolean = null;
    _bitstream: number = null;
    public constructor(options = {}) {
        super(Object.assign({ readableObjectMode: true, ...options }));
    };

    readonly _destroy = (error?: Error | null, callback?: TransformDone) => {
       if (error) console.log(error);
       if (callback) callback(error);

       delete this._bitstream;
       delete this._HeadSegment;
       this?.destroy();
    };

    readonly _transform = (chunk: Buffer, encoding: string, done: TransformDone) => {
        //Если произойдет ошибка во время чтения потока завершим декодирование
        try {
            while (chunk) {
                const result = this.#ReadBufferStream(chunk);

                if (result) chunk = result;
                else break;
            }
        } catch (error) {
            return done(error);
        }
        done();
    };

    /**
     * @description Определяем где нужно взять фрагмент
     * @param chunk {Buffer} Фрагмент потока
     * @private
     */
    readonly #ReadBufferStream = (chunk: Buffer): false | Buffer => {
        if (chunk.length < OGG_PAGE_HEADER_SIZE) return false;
        if (!chunk.subarray(0, 4).equals(OGGs_HEADER)) throw Error(`Шаблон захвата не совпадает с ${OGGs_HEADER}`);
        if (chunk.readUInt8(4) !== STREAM_STRUCTURE_VERSION) throw Error(`Структура потока не совпадает с ${STREAM_STRUCTURE_VERSION}`);

        if (chunk.length < 27) return false;

        const pageSegments: number = chunk.readUInt8(26); //Считывает 8-битное целое число(26) из буфера
        if (chunk.length < 27 + pageSegments) return false;
        const table: Buffer = chunk.subarray(27, 27 + pageSegments); //Возвращает новый буфер, который ссылается на ту же память, что и оригинал, но смещен и обрезан по начальному и конечному индексам.
        const bitstream: number = chunk.readUInt32BE(14); //Считывает 32-битное целое число(14) из буфера

        const sizes: Array<number> = [];
        let totalSize = 0;

        //Собираем читаемые сегменты вместе
        for (let i = 0; i < pageSegments;) {
            let size = 0, x = 255;

            //Создаем цикл пока x не будет равен 255
            while (x === 255) {
                if (i >= table.length) return false;
                x = table.readUInt8(i);
                i++;
                size += x;
            }

            sizes.push(size);
            totalSize += size;
        }

        if (chunk.length < 27 + pageSegments + totalSize) return false;
        let start = 27 + pageSegments;

        //Начинаем запись сегментов в текущий класс
        for (let size of sizes) {
            const segment: Buffer = chunk.subarray(start, start + size);
            const header: Buffer = segment.subarray(0, 8);

            //Если this._head не пустой
            if (this._HeadSegment) {
                if (header.equals(OPUS_TAGS)) this.emit('tags', segment);
                else if (this._bitstream === bitstream) this.push(segment);

            //Если this._head пустой
            } else if (header.equals(OPUS_HEAD)) {
                this.emit('head', segment);
                this._HeadSegment = true;
                this._bitstream = bitstream;

            //Если chunk невозможно опознать
            } else this.emit('unknownSegment', segment);

            start += size;
        }
        return chunk.subarray(start);
    };
}