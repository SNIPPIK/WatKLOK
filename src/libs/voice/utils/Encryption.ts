import {SodiumEncryption} from "@lib/voice/utils/Sodium";
import {ConnectionData} from "@lib/voice/Socket";
import {Buffer} from "node:buffer";

const SUPPORTED_ENCRYPTION_MODES = ["xsalsa20_poly1305_lite", "xsalsa20_poly1305_suffix", "xsalsa20_poly1305"];
const sodium = SodiumEncryption.getMethods(), MAX_NONCE_SIZE = 2 ** 32 - 1;

/**
 * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
 * @param packet - Пакет Opus для шифрования
 * @param connectionData - Текущие данные подключения экземпляра
 */
export function encryptOpusPacket(packet: Buffer, connectionData: ConnectionData) {
    const {secretKey, encryptionMode} = connectionData;

    switch (encryptionMode) {
        case "xsalsa20_poly1305_suffix": {
            const random = sodium.random(24, connectionData.nonceBuffer);
            return [sodium.close(packet, random, secretKey), random];
        }
        case "xsalsa20_poly1305_lite": {
            connectionData.nonce++;
            if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
            connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
            return [sodium.close(packet, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4)];
        }
        default:
            return [sodium.close(packet, Buffer.alloc(24), secretKey)];
    }
}

/**
 * @description Выбирает режим шифрования из списка заданных параметров. Выбирает наиболее предпочтительный вариант.
 * @param options - Доступные варианты шифрования
 */
export function chooseEncryptionMode(options: string[]): string {
    const option = options.find((option) => SUPPORTED_ENCRYPTION_MODES.includes(option));
    if (!option) throw new Error(`No compatible encryption modes. Available include: ${options.join(', ')}`);

    return option;
}

/**
 * @description Возвращает случайное число, находящееся в диапазоне n бит.
 * @param numberOfBits - Количество бит
 */
export function randomNBit(numberOfBits: number) {
    return Math.floor(Math.random() * 2 ** numberOfBits);
}