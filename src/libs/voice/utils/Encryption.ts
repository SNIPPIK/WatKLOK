const SUPPORTED_ENCRYPTION_MODES = ["xsalsa20_poly1305_lite", "xsalsa20_poly1305_suffix", "xsalsa20_poly1305"];

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