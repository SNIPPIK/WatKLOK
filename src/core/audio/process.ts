import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { env } from "#db/env";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Управление процессом FFmpeg.
 *
 * Совместимо с Node.js и Bun благодаря node:child_process.
 *
 * @class Process
 * @public
 */
export class Process {
    /** Запущенный дочерний процесс */
    private _process: ChildProcessWithoutNullStreams | null = null;

    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @returns ChildProcessWithoutNullStreams | null
     * @public
     */
    public get process(): ChildProcessWithoutNullStreams | null {
        return this._process;
    };

    /**
     * @description Поток вывода FFmpeg
     * @returns Readable | null
     * @public
     */
    public get stdout() {
        return this._process?.stdout ?? null;
    };

    /**
     * @description Запускаем FFmpeg
     * @param args Аргументы запуска
     * @param name Путь до исполняемого файла
     * @constructor
     * @public
     */
    public constructor(args: string[], name: string = FFMPEG_PATH ?? "ffmpeg") {
        // Не изменяем исходный массив аргументов.
        const ffmpegArgs = [...args];

        // Ищем источник входных данных.
        const inputIndex = ffmpegArgs.indexOf("-i");
        const input = inputIndex !== -1
            ? ffmpegArgs[inputIndex + 1]
            : undefined;

        // Настраиваем переподключение для HTTP(S)-источников.
        if (input && /^https?:\/\//i.test(input)) {
            ffmpegArgs.splice(
                inputIndex,
                0,
                "-reconnect", "1",
                "-reconnect_streamed", "1",
                "-reconnect_delay_max", "5",
                "-reconnect_on_network_error", "1"
            );
        }

        // Общие параметры FFmpeg.
        ffmpegArgs.unshift(
            "-vn",
            "-nostdin",
            "-hide_banner",
            "-analyzeduration", "200",
            "-probesize", "32",
            "-loglevel", "error"
        );

        /*
         * Используем Node.js-совместимый API.
         *
         * В Bun он работает через совместимость с node:child_process.
         * Это позволяет сохранить привычные ChildProcess и Readable,
         * которые используются остальной частью аудиосистемы.
         *
         * Переменная env намеренно не переопределяется:
         * дочерний процесс наследует окружение текущего процесса.
         */
        const child = spawn(name, ffmpegArgs, {
            stdio: "pipe",
            shell: false,
            windowsHide: true
        });

        this._process = child;

        /*
         * Не уничтожаем stdout на событии exit.
         *
         * После exit выходные потоки ещё могут содержать данные.
         * Событие close вызывается после закрытия потоков stdio.
         */
        child.once("close", this.destroy);
        child.once("error", this.destroy);
    };

    /**
     * @description Останавливаем процесс и освобождаем ресурсы.
     * Повторный вызов безопасен.
     * @returns void
     * @public
     */
    public destroy = (): void => {
        const child = this._process;

        if (!child) return;

        // Защищаемся от повторного уничтожения.
        this._process = null;

        // Удаляем только внутренние обработчики.
        // Пользовательские обработчики процесса сохраняются.
        child.removeListener("close", this.destroy);
        child.removeListener("error", this.destroy);

        // Закрываем потоки.
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();

        // Если процесс уже завершился, дополнительно ничего не делаем.
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;

        // Сначала пробуем штатное завершение.
        try {
            child.kill("SIGTERM");
        } catch {
            return;
        }

        /*
         * ChildProcess.killed означает, что сигнал был отправлен,
         * а не то, что сам процесс действительно завершился.
         *
         * Поэтому после таймаута проверяем exitCode и signalCode.
         */
        const killTimer = setTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null) return;

            try {
                child.kill("SIGKILL");
            } catch {
                // Процесс мог завершиться между проверкой и kill().
            }
        }, 1_500);

        // Таймер не должен удерживать приложение активным.
        killTimer.unref?.();
    };
}

/**
 * @author SNIPPIK
 * @description Путь до исполняемого файла FFmpeg.
 * @public
 */
export let FFMPEG_PATH: string | null = null;

/**
 * @author SNIPPIK
 * @description Параметр прокси для FFmpeg.
 * @public
 */
export const FFMPEG_PROXY = env.get<string>(
    "APIs.ffmpeg.proxy",
    env.get("APIs.proxy", null)
);

/**
 * @description Определяем доступный исполняемый файл FFmpeg.
 *
 * Проверяем пользовательский путь, локальные варианты
 * и затем FFmpeg, доступный через PATH.
 */
(() => {
    const cache = env.get("cache.dir");
    const configuredPath = env.get("ffmpeg.path");

    const candidates: string[] = [];

    if (typeof cache === "string" && cache.length > 0) {
        candidates.push(
            path.join(cache, "ffmpeg"),
            cache
        );

        if (process.platform === "win32") candidates.push(path.join(cache, "ffmpeg.exe"));
    }

    if (typeof configuredPath === "string" && configuredPath.length > 0) candidates.push(configuredPath);
    const bundledFFmpeg = path.resolve("build/native/ffmpeg");

    candidates.push(bundledFFmpeg);

    if (process.platform === "win32") candidates.push(`${bundledFFmpeg}.exe`);

    // Последний вариант — поиск через PATH.
    candidates.push("ffmpeg");

    // Убираем дублирующиеся пути.
    const uniqueCandidates = [...new Set(candidates)];

    for (const candidate of uniqueCandidates) {
        try {
            const result = spawnSync(
                candidate,
                ["-hide_banner", "-version"],
                {
                    windowsHide: true,
                    shell: false,
                    stdio: "ignore",
                    timeout: 5_000
                }
            );

            // Одной попытки запуска недостаточно:
            // проверяем, что FFmpeg действительно запустился успешно.
            if (!result.error && result.status === 0) {
                FFMPEG_PATH = candidate;
                return;
            }
        } catch {
            // Пропускаем отсутствующие и недоступные варианты.
        }
    }

    throw new Error(
        "[Critical] FFmpeg not found! " +
        "Install FFmpeg or configure ffmpeg.path."
    );
})();