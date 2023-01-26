import {workerData, parentPort, isMainThread} from "worker_threads";
import {URL, URLSearchParams} from 'node:url';
import * as querystring from "querystring";
import {httpsClient} from "@httpsClient";
import * as vm from "vm";

/**
 * Запускаем расшифровку в другом потоке, поскольку из-за <vm>.Script возникают утечки памяти
 * После получения данных удаляем поток и устраняем утечку
 */
if (!isMainThread) (async () => {
    const formats = await extractSignature(workerData.formats, workerData.html);

    delete workerData.formats;
    delete workerData.html;

    return parentPort.postMessage({format: formats});
})();

//====================== ====================== ====================== ======================
/*                        Original YouTube Signature extractor                             //
//             https://github.com/fent/node-ytdl-core/blob/master/lib/sig.js               */
//====================== ====================== ====================== ======================

export interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
}

//====================== ====================== ====================== ======================
/*                               Executes decryption runtime                               */
//====================== ====================== ====================== ======================
/**
 * @description Применяет преобразование параметра расшифровки и n ко всем URL-адресам формата.
 * @param {Array.<Object>} formats
 * @param {string} html5player
 */
function extractSignature(formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat> {
    //Делаем сортировку (получаем самый лучший формат по качеству)
    const sortingQuality = formats.filter((format: YouTubeFormat) => (format.mimeType?.match(/opus/) || format?.mimeType?.match(/audio/)) && format.bitrate > 100 );

    return new Promise<YouTubeFormat>(async (resolve) => {
        //Если YouTube уже дал готовую ссылку на исходный файл, то пропускаем расшифровку
        if (sortingQuality?.length && sortingQuality[0]?.url) return resolve(sortingQuality[0]);

        //Пробуем 1 способ получения ссылки
        try {
            const functions = await extractFunctions(html5player);
            const decipherScript = functions.length ? new vm.Script(functions[0]) : null;
            const nTransformScript = functions.length > 1 ? new vm.Script(functions[1]) : null;

            for (const format of sortingQuality) {
                const url = setDownloadURL(format, decipherScript, nTransformScript);

                if (!url) sortingQuality.shift();
                else { format.url = url; break; }
            }
        } catch (e) { //Если 1 способ не помог пробуем 2
            const page = await httpsClient.parseBody(html5player) as string;
            const tokens = parseTokens(page);

            for (const format of sortingQuality) {
                const url = setDownload(format, tokens);

                if (!url) sortingQuality.shift();
                else { format.url = url; break; }
            }
        }

        return resolve(sortingQuality[0]);
    });
}
//====================== ====================== ====================== ======================
/*                            Functions of the new decryption                              */
//====================== ====================== ====================== ======================
/**
 * @description Извлечь функции расшифровки подписи и преобразования n параметров из файла html5player
 * @param {string} html5Link
 * @returns {Promise<Array.<string>>}
 */
async function extractFunctions (html5Link: string) {
    const body = await httpsClient.parseBody(html5Link) as string, functions: string[] = [];

    if (!body) return;

    const decipherName = body.split(`a.set("alr","yes");c&&(c=`)[1].split(`(decodeURIC`)[0];
    let ncodeName = body.split(`&&(b=a.get("n"))&&(b=`)[1].split(`(b)`)[0];

    //extract Decipher
    if (decipherName && decipherName.length) {
        const functionStart = `${decipherName}=function(a)`;
        const ndx = body.indexOf(functionStart);

        if (ndx >= 0) {
            let functionBody = `var ${functionStart}${cutAfterJS(body.slice(ndx + functionStart.length))}`;
            functions.push(`${extractManipulations(functionBody, body)};${functionBody};${decipherName}(sig);`);
        }
    }

    //extract ncode
    if (ncodeName.includes('[')) ncodeName = body.split(`${ncodeName.split('[')[0]}=[`)[1].split(`]`)[0];
    if (ncodeName && ncodeName.length) {
        const functionStart = `${ncodeName}=function(a)`;
        const ndx = body.indexOf(functionStart);

        if (ndx >= 0) functions.push(`var ${functionStart}${cutAfterJS(body.slice(ndx + functionStart.length))};${ncodeName}(ncode);`);
    }

    //Проверяем если ли functions
    if (!functions || !functions.length) return;

    return functions;
}
//====================== ====================== ====================== ======================
/**
 * @description Пытаемся вытащить фрагмент для дальнейшей манипуляции
 * @param caller {string}
 * @param body {string}
 */
function extractManipulations(caller: string, body: string) {
    const functionName = caller.split(`a=a.split("");`)[1].split(".")[0];
    if (!functionName) return '';

    const functionStart = `var ${functionName}={`;
    const ndx = body.indexOf(functionStart);
    if (ndx < 0) return '';

    return `var ${functionName}=${cutAfterJS(body.slice(ndx + functionStart.length - 1))}`;
}
//====================== ====================== ====================== ======================
/**
 * @description Применить расшифровку и n-преобразование к индивидуальному формату
 * @param format {Object}
 * @param decipherScript {vm.Script}
 * @param nTransformScript {vm.Script}
 */
function setDownloadURL(format: YouTubeFormat, decipherScript?: vm.Script, nTransformScript?: vm.Script): string | void {
    const url = format.signatureCipher || format.cipher;

   if (url && decipherScript && !format.url) {
       const decipher =  _decipher(url, decipherScript);

       if (nTransformScript) return _ncode(decipher, nTransformScript);
       return decipher;
   } else {
       if (nTransformScript) return _ncode(format.url, nTransformScript);
   }
}
//====================== ====================== ====================== ======================
/**
 * @description Расшифровка ссылки
 * @param url {string} Ссылка которая не работает
 * @param decipherScript {vm.Script}
 */
function _decipher(url: string, decipherScript: vm.Script): string {
    const extractUrl = querystring.parse(url);
    const decodeURL = decodeURIComponent(extractUrl.url as string);
    const sig = extractUrl.sp ? extractUrl.sp : "signature";

    try {
        return `${decodeURL}&${sig}=${decipherScript.runInNewContext({sig: decodeURIComponent(extractUrl.s as string)})}`;
    } catch (e) { return decodeURL; }
}
//====================== ====================== ====================== ======================
/**
 * @description Добавляем ссылке n=sig
 * @param url {string} Ссылка которая работает
 * @param nTransformScript {vm.Script}
 */
function _ncode(url: string, nTransformScript: vm.Script) {
    const components = new URL(url);
    const n = components.searchParams.get('n');

    if (!n) return url;

    try {
        components.searchParams.set('n', nTransformScript.runInNewContext({ncode: n}));
    } catch (e) { return components.toString(); }

    return components.toString();
}
//====================== ====================== ====================== ======================
/**
 * @description Сопоставление начальной и конечной фигурной скобки входного JS
 * @param mixedJson {string}
 * @returns {string}
 */
function cutAfterJS(mixedJson: string): string {
    let open, close; //Define the general open and closing tag

    if (mixedJson[0] === '[') { open = '['; close = ']'; }
    else if (mixedJson[0] === '{') { open = '{'; close = '}'; }

    if (!open) throw new Error(`Can't cut unsupported JSON (need to begin with [ or { ) but got: ${mixedJson[0]}`);

    // counter - Current open brackets to be closed
    // isEscaped - States if the current character is treated as escaped or not
    // isEscapedObject = States if the loop is currently inside an escaped js object
    let counter = 0, isEscaped = false, isEscapedObject = null;

    // Go through all characters from the start
    for (let i = 0; i < mixedJson.length; i++) {
        // End of current escaped object
        if (!isEscaped && isEscapedObject !== null && mixedJson[i] === isEscapedObject.end) {
            isEscapedObject = null;
            continue;
            // Might be the start of a new escaped object
        } else if (!isEscaped && isEscapedObject === null) {
            for (const escaped of ESCAPING_SEGMENT) {
                if (mixedJson[i] !== escaped.start) continue;
                // Test startPrefix against last 10 characters
                if (!escaped.startPrefix || mixedJson.substring(i - 10, i).match(escaped.startPrefix)) {
                    isEscapedObject = escaped;
                    break;
                }
            }
            // Continue if we found a new escaped object
            if (isEscapedObject !== null) continue;
        }

        // Toggle the isEscaped boolean for every backslash
        // Reset for every regular character
        isEscaped = mixedJson[i] === '\\' && !isEscaped;

        if (isEscapedObject !== null) continue;

        if (mixedJson[i] === open) counter++;
        else if (mixedJson[i] === close) counter--;

        // All brackets have been closed, thus end of JSON is reached
        if (counter === 0) return mixedJson.substring(0, i + 1);
    }

    // We ran through the whole string and ended up with an unclosed bracket
    throw Error("Can't cut unsupported JSON (no matching closing bracket found)");
}
//====================== ====================== ====================== ======================
/*                            Functions of the old decryption                              */
//====================== ====================== ====================== ======================
// RegExp for various js functions
const var_js = '[a-zA-Z_\\$]\\w*';
const singleQuote = `'[^'\\\\]*(:?\\\\[\\s\\S][^'\\\\]*)*'`;
const duoQuote = `"[^"\\\\]*(:?\\\\[\\s\\S][^"\\\\]*)*"`;
const quote_js = `(?:${singleQuote}|${duoQuote})`;
const key_js = `(?:${var_js}|${quote_js})`;
const prop_js = `(?:\\.${var_js}|\\[${quote_js}\\])`;
const empty_js = `(?:''|"")`;
const reverse_function = ':function\\(a\\)\\{' + '(?:return )?a\\.reverse\\(\\)' + '\\}';
const slice_function = ':function\\(a,b\\)\\{' + 'return a\\.slice\\(b\\)' + '\\}';
const splice_function = ':function\\(a,b\\)\\{' + 'a\\.splice\\(0,b\\)' + '\\}';
const swap_function =
    ':function\\(a,b\\)\\{' +
    'var c=a\\[0\\];a\\[0\\]=a\\[b(?:%a\\.length)?\\];a\\[b(?:%a\\.length)?\\]=c(?:;return a)?' +
    '\\}';
const obj_regexp = new RegExp(
    `var (${var_js})=\\{((?:(?:${key_js}${reverse_function}|${key_js}${slice_function}|${key_js}${splice_function}|${key_js}${swap_function}),?\\r?\\n?)+)};`
);
const function_regexp = new RegExp(
    `${
        `function(?: ${var_js})?\\(a\\)\\{` + `a=a\\.split\\(${empty_js}\\);\\s*` + `((?:(?:a=)?${var_js}`
    }${prop_js}\\(a,\\d+\\);)+)` +
    `return a\\.join\\(${empty_js}\\)` +
    `\\}`
);
const reverse_regexp = new RegExp(`(?:^|,)(${key_js})${reverse_function}`, 'm');
const slice_regexp = new RegExp(`(?:^|,)(${key_js})${slice_function}`, 'm');
const splice_regexp = new RegExp(`(?:^|,)(${key_js})${splice_function}`, 'm');
const swap_regexp = new RegExp(`(?:^|,)(${key_js})${swap_function}`, 'm');
const ESCAPING_SEGMENT = [
    // Strings
    { start: '"', end: '"' },
    { start: "'", end: "'" },
    { start: '`', end: '`' },

    // RegEx
    { start: '/', end: '/', startPrefix: /(^|[[{:;,])\s?$/ }
];
//====================== ====================== ====================== ======================
/**
 * @description Проводим некоторые манипуляции с signature
 * @param tokens {string[]}
 * @param signature {string}
 */
function DecodeSignature(tokens: string[], signature: string): string {
    let sig = signature.split("");

    for (const token of tokens) {
        let position;
        const nameToken = token.slice(2);

        switch (token.slice(0, 2)) {
            case "sw": { position = parseInt(nameToken); swapPositions<string>(sig, position); break; }
            case "sl": { position = parseInt(nameToken); sig = sig.slice(position); break; }
            case "sp": { position = parseInt(nameToken); sig.splice(0, position); break; }
            case "rv": { sig.reverse(); break; }
        }
    }
    return sig.join("");
}
//====================== ====================== ====================== ======================
/**
 * @description Берем данные с youtube html5player
 * @param page {string} Страница html5player
 */
function parseTokens(page: string): string[] {
    const funAction = function_regexp.exec(page);
    const objAction = obj_regexp.exec(page);

    if (!funAction || !objAction) return null;

    const object = objAction[1].replace(/\$/g, '\\$');
    const objPage = objAction[2].replace(/\$/g, '\\$');
    const funPage = funAction[1].replace(/\$/g, '\\$');

    let result: RegExpExecArray, tokens: string[] = [], keys: string[] = [];

    [reverse_regexp, slice_regexp, splice_regexp, swap_regexp].forEach((res) => {
        result = res.exec(objPage);
        keys.push(replacer(result));
    });

    const parsedKeys = `(${keys.join('|')})`;
    const tokenizeRegexp = new RegExp(`(?:a=)?${object}(?:\\.${parsedKeys}|\\['${parsedKeys}'\\]|\\["${parsedKeys}"\\])` + `\\(a,(\\d+)\\)`, 'g');

    while ((result = tokenizeRegexp.exec(funPage)) !== null) {
        (() => {
            const key = result[1] || result[2] || result[3];
            switch (key) {
                case keys[0]: return tokens.push('rv');
                case keys[1]: return tokens.push(`sl${result[4]}`);
                case keys[2]: return tokens.push(`sp${result[4]}`);
                case keys[3]: return tokens.push(`sw${result[4]}`);
            }
        })();
    }

    return tokens;
}
//====================== ====================== ====================== ======================
/**
 * @description Уменьшаем кол-во кода
 * @param res {RegExpExecArray}
 */
function replacer(res: RegExpExecArray):string {
    return res && res[1].replace(/\$/g, '\\$').replace(/\$|^'|^"|'$|"$/g, '');
}
//====================== ====================== ====================== ======================
/**
 * @description Изменяем ссылки
 * @param format {YouTubeFormat} Формат youtube
 * @param tokens {RegExpExecArray} Токены
 */
function setDownload(format: YouTubeFormat, tokens: string[]): string {
    const cipher = format.signatureCipher || format.cipher;

    if (cipher) {
        const params = Object.fromEntries(new URLSearchParams(cipher));
        Object.assign(format, params);
        delete format.signatureCipher;
        delete format.cipher;
    }

    if (tokens && format.s && format.url) {
        const signature = DecodeSignature(tokens, format.s);
        const Url = new URL(decodeURIComponent(format.url));
        Url.searchParams.set('ratebypass', 'yes');

        if (signature) Url.searchParams.set(format.sp || 'signature', signature);

        return Url.toString();
    }

    return null;
}
/**
 * @description Смена позиции в Array
 * @param array {Array<any>} Array
 * @param position {number} Номер позиции
 */
function swapPositions<V>(array: V[], position: number): void {
    const first = array[0];
    array[0] = array[position];
    array[position] = first;
}