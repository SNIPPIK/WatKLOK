import {Logger} from "@Logger";
import {readdirSync} from "fs";
import {env} from "@env";

export class initDataDir<type> {
    private readonly path: string;
    private readonly callback: (file: string, data: type) => void;
    private readonly isFiles: boolean;
    private file: string;


    /**
     * @description Загружаем первый экспорт из файла
     */
    private get loadFile() {
        const importFile = require(`../${this.file}`);
        const keysFile = Object.keys(importFile);

        if (keysFile.length <= 0) return null;

        return new importFile[keysFile[0]];
    };


    public constructor(path: string, callback: (file: string, data: type) => void, isFiles: boolean = false) {
        this.path = `src/${path}`; this.callback = callback; this.isFiles = isFiles
    };


    /**
     * @description Начинаем чтение
     */
    public readonly reading = () => {
        if (this.isFiles) return this.readDir();

        readdirSync(this.path).forEach((dir) => {
            if (dir.endsWith(".js")) return;
            return this.readDir(dir);
        });
    };


    /**
     * @description Загружаем файлы из директории
     * @param dir {string} Директория из которой будем читать
     */
    private readonly readDir = (dir?: string) => {
        const path = dir ? `${this.path}/${dir}/` : this.path;

        readdirSync(path).forEach((file) => {
            if (!file.endsWith(".js")) return;

            try {
                this.file = `${path}/${file}`;
                const hasLoad: type = this.loadFile;

                if (env.get("debug.fs")) Logger.debug(`Fs: [Load]: ${path}${path.endsWith("/") || file.startsWith("/") ? file : `/${file}`}`);

                this.callback(this.file, hasLoad);
            } catch (e) { Logger.error(e); }
        });
    }
}