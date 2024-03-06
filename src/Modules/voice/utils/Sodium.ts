import process from "node:process";

const SodiumLibs = {
    //https://www.npmjs.com/package/sodium-native
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
    //https://www.npmjs.com/package/sodium
    "sodium": (sodium: any): Methods => ({
        open: sodium.api.crypto_secretbox_open_easy,
        close: sodium.api.crypto_secretbox_easy,
        random: (num, buffer: Buffer = Buffer.allocUnsafe(num)) => {
            sodium.api.randombytes_buf(buffer);
            return buffer;
        }
    })
};
export const Sodium: Methods = {
    open:   () => { throw new Error(`Cannot play audio as no valid encryption package is installed.\n- Install sodium-native or sodium.`) },
    close:  () => { throw new Error(`Cannot play audio as no valid encryption package is installed.\n- Install sodium-native or sodium.`) },
    random: () => { throw new Error(`Cannot play audio as no valid encryption package is installed.\n- Install sodium-native or sodium.`) },
};

/**
 * @description Загружаем модуль в Sodium
 */
const LoadModule = async () => {
    for (const name of Object.keys(SodiumLibs) as (keyof typeof SodiumLibs)[]) {
        try {
            const lib = require(name);

            if (lib?.ready) await lib.ready;

            Object.assign(Sodium, SodiumLibs[name](lib));
            delete require.cache[require.resolve(name)];
            break;
        } catch {}
    }
}
if (!process["argv"].includes("--ShardManager")) LoadModule();


/**
 * @description Выдаваемы методы для работы watklok/voice
 */
interface Methods {
    close?(opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer;
    open?(buffer: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer | null;
    random?(bytes: number, nonce: Buffer): Buffer;
}