import querystring from "node:querystring";
import {httpsClient} from "@lib/request";
import {Script} from "vm";

/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param regex - Как искать имена
 * @param body - Строка где будем искать
 * @param first - Выдача первого объекта
 */
const mRegex = (regex: string | RegExp, body: string, first: boolean = true) => {
    const reg =  body.match(new RegExp(regex, "s"));
    return first ? reg[0] : reg[1];
};

/**
 * @author SNIPPIK
 * @description Получаем имена функций
 * @param body - Станица youtube
 * @param regexps
 */
const extractName = (body: string, regexps: string[]): string => {
    let name: string = "";

    for (const regex of regexps) {
        try {
            name = mRegex(regex, body, false);
            const id = name.indexOf("[0]");

            if (id > -1) name = mRegex(`${name.substring(id, 0).replace(/\$/g, '\\$')}=\\[([a-zA-Z0-9$\\[\\]]{2,})\\]`, body, false);

            break;
        } catch (err) {}
    }

    if (!name || name.includes("[")) throw Error("[YouTube.Decoder]: Fail find name function!");
    return name;
};

/**
 * @author SNIPPIK
 * @description Функции для расшифровки
 */
const extractors: { name: string, callback: (body: string) => string }[] = [
    /**
     * @description Получаем функцию с данными
     */
    {
        name: "extractDecipherFunction",
        callback: (body) => {
            try {
                const helperObject = mRegex(HELPER_REGEXP, body);
                const decipherFunc = mRegex(DECIPHER_REGEXP, body);
                const resultFunc = `var ${DECIPHER_FUNC_NAME}=${decipherFunc};`;
                const callerFunc = `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;
                return helperObject + resultFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    },

    /**
     * @description Получаем имя функции
     */
    {
        name: "extractDecipher",
        callback: (body) => {
            try {
                const decipherFuncName = extractName(body, DECIPHER_NAME_REGEXPS);
                const funcPattern = `(${decipherFuncName.replace(/\$/g, '\\$')}=function\\([a-zA-Z0-9_]+\\)\\{.+?\\})`;
                const decipherFunc = `var ${mRegex(funcPattern, body, false)};`;
                const helperObjectName = mRegex(";([A-Za-z0-9_\\$]{2,})\\.\\w+\\(", decipherFunc, false);
                const helperPattern = `(var ${helperObjectName.replace(/\$/g, '\\$')}=\\{[\\s\\S]+?\\}\\};)`;
                const helperObject = mRegex(helperPattern, body, false);
                const callerFunc = `${decipherFuncName}(${DECIPHER_ARGUMENT});`;
                return helperObject + decipherFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    },

    /**
     * @description Получаем данные n кода - для ускоренной загрузки с серверов
     */
    {
        name: "extractTransform",
        callback: (body) => {
            try {
                const nFunc = mRegex(N_TRANSFORM_REGEXP, body);
                const resultFunc = `var ${N_TRANSFORM_FUNC_NAME}=${nFunc}`;
                const callerFunc = `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;
                return resultFunc + callerFunc;
            } catch (e) {
                return null;
            }
        }
    }
];

/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на исходный файл для youtube
 */
export class Youtube_decoder {
    /**
     * @description Применяем преобразования decipher и n параметров ко всем URL-адресам формата.
     * @param formats - Все форматы аудио или видео
     * @param html5player - Ссылка на плеер
     */
    public static decipherFormats = async (formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat[]> =>  {
        const [decipherScript, nTransformScript] = await this.extractPage(html5player);

        for (let item of formats) {
            item.url = this.setDownloadURL(item, {decipher: decipherScript, nTransform: nTransformScript});
        }

        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     */
    private static setDownloadURL = (format: YouTubeFormat, script: {decipher?: Script, nTransform?: Script}): string => {
        const url = format.url || format.signatureCipher || format.cipher, {decipher, nTransform} = script;
        const extractDecipher = (url: string): string => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url as string;

            const components = new URL(decodeURIComponent(args.url as string));
            components.searchParams.set(args.sp as string ? args.sp as string : DECIPHER_NAME, decipher.runInNewContext({sig: decodeURIComponent(args.s as string)}));
            return components.toString();
        };
        const extractN = (url: string): string => {
            const components = new URL(decodeURIComponent(url));
            const n = components.searchParams.get(N_NAME);
            if (!n || !nTransform) return url;
            components.searchParams.set(N_NAME, nTransform.runInNewContext({ncode: n}));
            return components.toString();
        };

        //Удаляем не нужные данные
        delete format.signatureCipher;
        delete format.cipher;

        return !format.url ? extractN(extractDecipher(url)) : extractN(url);
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param html5 - Ссылка на плеер
     */
    private static extractPage = async (html5: string) => {
        const body = await new httpsClient(html5).toString;

        if (body instanceof Error) return null;
        return [
            this.extraction([extractors[1].callback, extractors[0].callback], body),
            this.extraction([extractors[2].callback], body)
        ];
    };

    /**
     * @description Получаем функции для расшифровки
     * @param functions -
     * @param body - Станица youtube
     */
    private static extraction = (functions: Function[], body: string) => {
        for (const callback of functions) {
            try {
                const func = callback(body);
                if (!func) continue;
                return new Script(func);
            } catch (err) {}
        }
        return null;
    };
}

/**
 * @description Общий стандарт аудио или видео json объекта
 * @interface YouTubeFormat
 */
interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
}


// NewPipeExtractor regexps
const DECIPHER_NAME_REGEXPS = [
    '\\bm=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(h\\.s\\)\\);',
    '\\bc&&\\(c=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(c\\)\\)',
    '(?:\\b|[^a-zA-Z0-9$])([a-zA-Z0-9$]{2,})\\s*=\\s*function\\(\\s*a\\s*\\)\\s*\\{\\s*a\\s*=\\s*a\\.split\\(\\s*""\\s*\\)',
    '([\\w$]+)\\s*=\\s*function\\((\\w+)\\)\\{\\s*\\2=\\s*\\2\\.split\\(""\\)\\s*;',
];

const N_TRANSFORM_FUNC_NAME = "SNPKNTransformFunc";
const DECIPHER_FUNC_NAME = "SNPKDecipherFunc";

const DECIPHER_ARGUMENT = "sig", DECIPHER_NAME = "signature";
const N_ARGUMENT = "ncode", N_NAME = "n";

// Player regexps
const VARIABLE_PART = '[a-zA-Z_\\$][a-zA-Z_0-9]*';
const VARIABLE_PART_DEFINE = `\\"?${VARIABLE_PART}\\"?`;
const BEFORE_ACCESS = '(?:\\[\\"|\\.)';
const AFTER_ACCESS = '(?:\\"\\]|)';
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ':function\\(a\\)\\{(?:return )?a\\.reverse\\(\\)\\}';
const SLICE_PART = ':function\\(a,b\\)\\{return a\\.slice\\(b\\)\\}';
const SPLICE_PART = ':function\\(a,b\\)\\{a\\.splice\\(0,b\\)\\}';
const SWAP_PART = ':function\\(a,b\\)\\{' +
    'var c=a\\[0\\];a\\[0\\]=a\\[b%a\\.length\\];a\\[b(?:%a.length|)\\]=c(?:;return a)?\\}';

const DECIPHER_REGEXP = `function(?: ${VARIABLE_PART})?\\(a\\)\\{` +
    `a=a\\.split\\(""\\);\\s*` +
    `((?:(?:a=)?${VARIABLE_PART}${VARIABLE_PART_ACCESS}\\(a,\\d+\\);)+)` +
    `return a\\.join\\(""\\)` +
    `\\}`;

const HELPER_REGEXP = `var (${VARIABLE_PART})=\\{((?:(?:${
    VARIABLE_PART_DEFINE}${REVERSE_PART}|${
    VARIABLE_PART_DEFINE}${SLICE_PART}|${
    VARIABLE_PART_DEFINE}${SPLICE_PART}|${
    VARIABLE_PART_DEFINE}${SWAP_PART}),?\\n?)+)\\};`;

const N_TRANSFORM_REGEXP = 'function\\(\\s*(\\w+)\\s*\\)\\s*\\{' +
    'var\\s*(\\w+)=(?:\\1\\.split\\(""\\)|String\\.prototype\\.split\\.call\\(\\1,""\\)),' +
    '\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]' +
    '(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\' +
    '{\\s*return"enhanced_except_([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,""\\))};';