export const Logger = new class {
    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly log = (text: string) => {
        this.sendLog(`\x1b[36mi\x1b[0m`, text);
    };


    /**
     * @description Отправляем лог с временем и красным текстом
     * @param text {string} Текст лога
     */
    public readonly error = (text: string) => {
        this.sendLog(`\x1b[41m \x1b[30mERROR \x1b[0m`, `\x1b[31m${text}\x1b[0m`, 5);
    };


    /**
     * @description Отправляем лог с временем
     * @param text {string} Текст лога
     */
    public readonly debug = (text: string) => {
        this.sendLog(`\x1b[46m \x1b[30mDEBUG \x1b[0m`, `\x1b[90m${text}\x1b[0m`, 14);
    };


    private sendLog = (status: string, text: string, supNum: number = 0) => {
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;
        const spaces = 135 - (status.length + text.length) - (time.length - supNum);

        if (spaces < 0) process.stdout.write(`${status} ${text} \n`);
        else process.stdout.write(`${status} ${text} ${" ".repeat(spaces)}${time} \n`);
    };
}
