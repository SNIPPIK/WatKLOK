import {StageChannel, VoiceChannel} from "discord.js";
import {AudioPlayer} from "../../Player/AudioPlayer";
import {Song} from "./Song";
import {VoiceConnection} from "@discordjs/voice";
import {MessagePlayer} from "../../Manager/MessagePlayer";
import {ClientMessage} from "../../../Handler/Events/Activity/Message";

export type LoopType = "song" | "songs" | "off";
export type AudioFilters = Array<string> | Array<string | number>;

// Очередь серверов
export class Queue {
    #Timer: NodeJS.Timeout = null; //Таймер для авто удаления очереди
    #hasDestroying: boolean = false; //Статус удаления (запущено ли удаление)

    readonly #_player: AudioPlayer; //Сам плеер
    //Каналы (message: TextChannel, voice: VoiceChannel, connection: VoiceConnection)
    readonly #_channels: { message: ClientMessage, voice: VoiceChannel | StageChannel, connection: VoiceConnection };
    readonly #_options: { random: boolean, loop: LoopType, stop: boolean } = { //Уникальные настройки
        random: false, //Рандомные треки (каждый раз в плеере будет играть разная музыка из очереди)
        loop: "off", //Тип повтора (off, song, songs)
        stop: false, //Пользователь выключил музыки или музыка сама закончилась
    };
    public audioFilters: Array<string> | Array<string | number> = [];  //Фильтры для FFmpeg
    public songs: Array<Song> = []; //Все треки находятся здесь

    //Создаем очередь
    public constructor(message: ClientMessage, voice: VoiceChannel) {
        this.#_player = new AudioPlayer();
        this.#_channels = { message, voice, connection: null};

        this.player.on("idle", () => onPlayerFunction.onIdlePlayer(message));
        this.player.on("error", (err: any) => onPlayerFunction.onErrorPlayer(err, message));
    };

    /**
     * @description Меняет местами треки
     * @param customNum {number} Если есть номер для замены
     */
    public readonly swapSongs = (customNum?: number) => {
        if (this.songs.length === 1) return this.player.stop();

        const SetNum = customNum ? customNum : this.songs.length - 1;
        const ArraySongs: Array<Song> = this.songs;
        const hasChange = ArraySongs[SetNum];

        ArraySongs[SetNum] = ArraySongs[0];
        ArraySongs[0] = hasChange;
        this.player.stop();
        return;
    };

    //Данные плеера
    public get player() {
        return this.#_player;
    };
    //Все каналы
    public get channels() {
        return this.#_channels;
    };
    //Настройки
    public get options() {
        return this.#_options;
    };

    //Удаление очереди
    public readonly cleanup = (sendDelQueue: boolean = true) => {
        const message = this.channels.message
        const {client, guild} = this.channels.message;
        const Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!Queue) return;
        const {channels, player, options} = Queue;

        //Удаляем сообщение о текущем треке
        if (message?.deletable) message?.delete().catch(() => undefined);
        if (player) {
            player.unsubscribe({connection: channels.connection});
            player.stop();
        }
        [Queue.songs, Queue.audioFilters].forEach(data => data = null);

        if (sendDelQueue) {
            if (options.stop) client.sendMessage({text: "🎵 | Музыка была выключена", message, type: "css"});
            else client.sendMessage({text: "🎵 | Музыка закончилась", message, type: "css"});
        }

        clearTimeout(this.#Timer);
        client.queue.delete(guild.id);
    };
    //Удаление очереди через время
    public readonly TimeDestroying = (state: "start" | "cancel"): void => {
        const player = this.player;

        //Запускаем таймер по истечению которого очереди будет удалена!
        if (state === "start") {
            if (this.#hasDestroying) return;

            this.#Timer = setTimeout(() => this.cleanup(false), 30e3);
            this.#hasDestroying = true;
            player.pause();
        } else { //Отменяем запущенный таймер
            if (!this.#hasDestroying) return;

            clearTimeout(this.#Timer);
            player.resume();
            this.#hasDestroying = false;
        }
    };
}

namespace onPlayerFunction {
    /**
     * @description Когда плеер завершит песню, он возвратит эту функцию
     * @param message {ClientMessage} Сообщение с сервера
     * @requires {isRemoveSong}
     * @private
     */
    export function onIdlePlayer(message: ClientMessage): void {
        const {client, guild} = message;
        const queue: Queue = client.queue.get(guild.id);

        setTimeout(() => {
            if (queue?.songs) isRemoveSong(queue); //Определяем тип loop

            //Рандомим номер трека, просто меняем их местами
            if (queue?.options?.random) {
                const RandomNumSong = Math.floor(Math.random() * queue.songs.length)
                queue.swapSongs(RandomNumSong);
            }

            return queue.player.play(message); //Включаем трек
        }, 500);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Когда плеер выдает ошибку, он возвратит эту функцию
     * @param err {Error | string} Ошибка
     * @param message {ClientMessage} Сообщение с сервера
     * @private
     */
    export function onErrorPlayer(err: Error | string, message: ClientMessage): void {
        const queue: Queue = message.client.queue.get(message.guild.id);

        //Выводим сообщение об ошибке
        MessagePlayer.toError(message, queue.songs[0], err);

        queue.songs.shift();
        setTimeout(() => queue.player.play(message), 1e3);
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Повтор музыки
 * @param queue {Queue} Очередь сервера
 */
function isRemoveSong({options, songs}: Queue): void {
    switch (options?.loop) {
        case "song": return;
        case "songs": return void songs.push(songs.shift());
        default: return void songs.shift();
    }
}