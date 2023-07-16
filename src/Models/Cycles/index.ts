import {createWriteStream, existsSync, mkdirSync, rename} from "fs";
import { AudioPlayer } from "@AudioPlayer/Audio/AudioPlayer";
import {ClientMessage} from "@Client/Message";
import {Song} from "@AudioPlayer/Queue/Song";
import {PlayersEmbeds} from "@Embeds/Player";
import {httpsClient} from "@Request";
import {Logger} from "@Logger";
import {env} from "@env";

const debug_cycle = env.get("debug.cycle");
const debug_cache = env.get("debug.player.cache");

export class MainCycle<T> {
    //Как фильтровать <T>
    protected readonly _filter?: (data: T, index?: number) => boolean;
    //Что надо выполнять
    protected readonly _next: (data: T) => void | Promise<boolean>;
    //Время через которое будет выполниться _next
    protected readonly duration: number = 5e3;
    protected readonly type: "multi" | "single" = "multi";

    private readonly _array: T[] = [];
    private _timeout: NodeJS.Timeout = null;
    private _time: number = 0;

    /**
     * @description Ищем элемент в очереди
     */
    protected readonly find = (callback: (data: T) => boolean): T => this._array.find(callback);


    /**
     * @description Добавляем элемент в очередь
     * @param data {any} Сам элемент
     */
    public set push(data: T) {
        if (this._array.includes(data)) return;
        this._array.push(data);

        //Запускаем цикл
        if (this._array.length === 1 && !this._timeout) {
            if (debug_cycle) Logger.debug(`[Cycle]: [${this.type}/${this.duration}]: Start cycle`);

            this._time = Date.now();
            setImmediate(this.CycleStep);
        }
    };


    /**
     * @description Удаляем элемент из очереди
     * @param data {any} Сам элемент
     */
    public set remove(data: T) {
        const index = this._array.indexOf(data);
        if (index != -1) this._array.splice(index, 1);
    };


    /**
     * @description Жизненный цикл плееров
     */
    private readonly CycleStep = (): void => {
        //Если в базе больше нет плееров
        if (this._array.length === 0) {
            if (debug_cycle) Logger.debug(`[Cycle]: [${this.type}/${this.duration}]: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
            this._time = 0;
            return;
        }

        //Если тип обновления "multi" будет обработаны все объекты за раз в течении "this._duration"
        if (this.type === "multi") {
            //Добавляем задержку, в размер пакета
            this._time += this.duration;

            return this.CycleMulti();
        }

        //Если тип обновления "single" будет обработан 1 объект затем 2
        return this.CycleSingle();
    };


    /**
     * @description обновляем постепенно Array
     */
    private readonly CycleMulti = () => {
        //Проверяем плееры, возможно ли отправить аудио пакет
        const array = this._array.filter(this._filter);

        //Отправляем пакеты в плееры
        while (array.length > 0) {
            const data = array.shift();

            try {
                //Отправляем его потом, поскольку while слишком быстро работает, могут возникнуть проблемы с потерями пакетов
                setImmediate(() => this._next(data));
            } catch (err) { this.removeErrorObject(err, data); }
        }

        //Выполняем функцию ~this._time ms
        this._timeout = setTimeout(this.CycleStep, this._time - Date.now());
    };


    /**
     * @description Обновляем один объект и ждем когда будет возврат
     */
    private readonly CycleSingle = () => {
        const array = this._array?.shift();

        (this._next(array) as Promise<boolean>).then(this.CycleStep).catch((err) => this.removeErrorObject(err, array));
    };


    /**
     * @description Удаляем объект выдающий ошибку
     * @param err {string} Ошибка из-за которой объект был удален
     * @param object {any} Объект который будет удален
     */
    private readonly removeErrorObject = (err: string, object: T) => {
        //Удаляем объект выдающий ошибку
        this.remove = object;

        //Отправляем сообщение об ошибке
        Logger.error(`[Cycle]: [${this.type}/${this.duration}]:: Error in this._next\n${err}\nRemove 1 object in cycle!`);
    };
}
/**
 *
 * @description Жизненный цикл всех плееров
 *
 */
export class PlayerCycle extends MainCycle<AudioPlayer> {
    protected readonly duration = parseInt(env.get("music.player.duration"));
    protected readonly _filter = (player: AudioPlayer) => player.hasPlayable;

    /**
     * @description Проверяем можно ли отправить пакет в голосовой канал
     */
    protected readonly _next = (player: AudioPlayer) => {
        const status = player?.status;

        //Если статус (idle или pause или его нет) прекратить выполнение функции
        if (status === "idle" || status === "pause" || !status || player?.connection?.state?.status !== "ready") return;

        //Если вдруг нет голосового канала
        if (!player.connection) { player.pause; return; }

        //Отправка музыкального пакета
        if (status === "read") {
            const packet: Buffer | null = player.stream?.read;

            if (packet) player.sendPacket = packet;
            else player.stop;
        }
    };
}
/**
 *
 * @description Жизненный цикл всех сообщений о текущем треке
 *
 */
export class MessageCycle extends MainCycle<ClientMessage> {
    protected readonly duration = parseInt(env.get("music.player.message")) * 1e3;
    protected readonly _filter = (message: ClientMessage) => !!message.edit;


    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     */
    public set push(message: ClientMessage) {
        const old = this.find(msg => msg.guild.id === message.guild.id);

        //Если это-же сообщение есть в базе, то нечего не делаем
        if (old) this.remove = old;

        super.push = message;
    };


    /**
     * @description Удаляем элемент из очереди есть он там есть
     * @param message {message} Сообщение
     */
    public set remove(message: ClientMessage) {
        //Если его возможно удалить, удаляем!
        if (message && message.deletable) message.delete().catch(() => undefined);

        super.remove = message;
    };


    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     */
    protected readonly _next = (message: ClientMessage) => {
        const {client, guild} = message;
        const queue = client.queue.get(guild.id);

        //Если очереди нет или нет трека в очереди, удаляем сообщение
        if (!queue || !queue?.song) {
            this.remove = message;
            return;
        }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate || queue.player.duration === 0) return;


        message.edit({embeds: [new PlayersEmbeds.toPlay(queue).toJson as any], components: message.components}).catch((e) => {
            if (e.message === "Unknown Message") this.remove = message;
            if (debug_cycle) Logger.debug(`[Cycle]: [${this.duration}]: [editMessage]: ${e.message}`);
        });
    };
}
/**
 *
 * @description Жизненный цикл всех треков для скачивания
 *
 */
export class DownloadManager extends MainCycle<Song> {
    protected readonly duration = 2e3;
    protected readonly type: "single" = "single";


    /**
     * @description Добавляем трек в локальную базу
     * @param track {Song}
     */
    public set push(track: Song) {
        const names = this.status(track);
        const findSong = this.find((song) => track.url === song.url || song.title === track.title);

        if (findSong || track.duration.seconds >= 800 || names.status !== "not") return;

        //Проверяем путь на наличие директорий
        if (!existsSync(names.path)) {
            let dirs = names.path.split("/");

            if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
            mkdirSync(dirs.join("/"), {recursive: true});
        }

        super.push = track;
    };


    /**
     * @description Скачиваем трек
     * @param track {Song} Сам трек
     */
    protected readonly _next = (track: Song) => {
        if (debug_cache) Logger.debug(`[AudioPlayer]: [Download]: ${track.url}`);

        return new Promise<boolean>((resolve) => {
            new httpsClient(track.link).request.then((req) => {
                if (req instanceof Error) return resolve(false);

                if (req.pipe) {
                    const status = this.status(track);
                    const file = createWriteStream(status.path);

                    file.once("ready", () => req.pipe(file));
                    file.once("error", console.warn);
                    file.once("finish", () => {
                        const refreshName = this.status(track).path.split(".raw")[0];

                        if (!req.destroyed) req.destroy();
                        if (!file.destroyed) file.destroy();

                        if (debug_cache) Logger.debug(`[AudioPlayer]: [Download]: in ${refreshName}.opus`);

                        rename(status.path, `${refreshName}.opus`, () => null);

                        return resolve(true);
                    });
                }

                return resolve(false);
            });
        });
    };


    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track {Song}
     */
    public readonly status = (track: Song): {status: "not" | "final" | "download", path: string} => {
        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const fullPath = `${env.get("music.cache.dir")}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    };
}