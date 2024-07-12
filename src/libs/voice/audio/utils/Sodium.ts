/**
 * @author SNIPPIK
 * @description Доступные библиотеки для включения
 */
const SodiumLibs = {
    "sodium-native": (sodium: any): Methods => ({
        open(buffer, nonce, secretKey) {
            if (buffer) {
                const output = Buffer.allocUnsafe(buffer.length - sodium.crypto_box_MACBYTES);
                if (sodium.crypto_secretbox_open_easy(output, buffer, nonce, secretKey)) return output;
            }

            return null;
        },

        random(num: number, buffer: Buffer = Buffer.allocUnsafe(num)) {
            sodium.randombytes_buf(buffer);
            return buffer;
        },

        close: (opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array) => {
            const output = Buffer.allocUnsafe(opusPacket.length + sodium.crypto_box_MACBYTES);
            sodium.crypto_secretbox_easy(output, opusPacket, nonce, secretKey);
            return output;
        }
    }),
    "sodium": (sodium: any): Methods => ({
        open: sodium.api.crypto_secretbox_open_easy,
        close: sodium.api.crypto_secretbox_easy,
        random: (num, buffer: Buffer = Buffer.allocUnsafe(num)) => {
            sodium.api.randombytes_buf(buffer);
            return buffer;
        }
    }),
    "libsodium-wrappers": (sodium: any): Methods => ({
        open: sodium.crypto_secretbox_open_easy,
        close: sodium.crypto_secretbox_easy,
        random: sodium.randombytes_buf,
    }),
    "tweetnacl": (tweetnacl: any): Methods => ({
        open: tweetnacl.secretbox.open,
        close: tweetnacl.secretbox,
        random: tweetnacl.randomBytes,
    }),
}, Sodium: Methods = {};

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие библиотек Sodium
 */
(async () => {
    const names = Object.keys(SodiumLibs), libs = `\n - ${names.join("\n - ")}`;

    for (const name of names) {
        try {
            const library = require(name);
            if (library?.ready) await library.ready;

            Object.assign(Sodium, SodiumLibs[name](library));
            delete require.cache[require.resolve(name)];
            return;
        } catch {}
    }

    throw new Error(`[WCritical]: No encryption package is installed. Set one to choose from. ${libs}`);
})();

/**
 * @author SNIPPIK
 * @description Выдаваемы методы для использования sodium
 * @class SodiumEncryption
 */
export class SodiumEncryption {
    public static getMethods = (): Methods => Sodium;
}

/**
 * @description Выдаваемы методы для работы voice
 */
interface Methods {
    close?(opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer;
    open?(buffer: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer | null;
    random?(bytes: number, nonce: Buffer): Buffer;
}