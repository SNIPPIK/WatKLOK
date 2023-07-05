import {createWriteStream, existsSync, mkdirSync, rename} from "fs";
import {httpsClient} from "@Request";

//Client
import {ClientMessage} from "@Client/Message";
import {env} from "@Client/Fs";

//AudioPlayer
import {MessageAction} from "@AudioPlayer/Message/Classes/MessageAction";
import {AudioPlayer} from "@AudioPlayer/Audio/AudioPlayer";
import {Song} from "@AudioPlayer/Queue/Song";

//Utils
import {Logger} from "@Utils/Logger";

//local
import {LifeCycle} from "./LifeCycle";


const debug = env.get("debug.cycle");
const dir = env.get("music.cache.dir");
const DownloadDebug = env.get("debug.player.cache");

/**
 *
 * @description Жизненный цикл всех плееров
 *
 */
export class PlayerCycle extends LifeCycle<AudioPlayer> {
    protected duration = parseInt(env.get("music.player.duration"));
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
 * @description Жизненный цикл всех сообщений с обновлением
 *
 */
export class MessageCycle extends LifeCycle<ClientMessage> {
    protected duration = parseInt(env.get("music.player.message")) * 1e3;
    protected readonly _filter = (message: ClientMessage) => !!message.edit;
    protected setImmediate = true;


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
        const queue = client.player.queue.get(guild.id);

        //Если очереди нет или нет трека в очереди, удаляем сообщение
        if (!queue || !queue?.song) {
            this.remove = message;
            return;
        }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate || queue.player.duration === 0) return;

        const Action = new MessageAction<"toPlay">("toPlay");

        message.edit({embeds: [new Action.embed(queue).toJson], components: message.components}).catch((e) => {
            if (e.message === "Unknown Message") this.remove = message;
            if (debug) Logger.debug(`[Cycle]: [${this.duration}]: [editMessage]: ${e.message}`);
        });
    };
}


export class DownloadManager extends LifeCycle<Song> {
    protected duration = 2e3;
    protected type: "single" = "single";


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
        if (DownloadDebug) Logger.debug(`[AudioPlayer]: [Download]: ${track.url}`);

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

                        if (DownloadDebug) Logger.debug(`[AudioPlayer]: [Download]: in ${refreshName}.opus`);

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
    public status = (track: Song): {status: "not" | "final" | "download", path: string} => {
        const author = track.author.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const song = track.title.replace(/[|,'";*/\\{}!?.:<>]/gi, "");
        const fullPath = `${dir}/[${author}]/[${song}]`;

        if (existsSync(`${fullPath}.opus`)) return { status: "final", path: `${fullPath}.opus` };
        else if (existsSync(`${fullPath}.raw`)) return { status: "download", path: `${fullPath}.raw` };
        return { status: "not", path: `${fullPath}.raw` };
    };
}
