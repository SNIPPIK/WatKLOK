import {spawn} from "child_process";
import {env} from "@Client/Fs";

const name = env.get("ffprobe.name");

/**
 * @description Получаем данные
 * @param url {string} Ссылка
 */
export function FFprobe(url: string): Promise<JSON> {
    const process = spawn(name, ["-print_format", "json", "-show_format", "-i", url]);
    let information = "";
    const cleanup = () => { if (!process.killed) process.kill("SIGKILL"); }

    return new Promise((resolve) => {
        process.once("close", () => { cleanup(); return resolve(JSON.parse(information + "}")) });
        process.stdout.once("data", (data) => information += data.toString());
        process.once("error", cleanup);
    });
}