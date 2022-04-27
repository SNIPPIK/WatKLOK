import {TypedEmitter} from "tiny-typed-emitter";
import {Song} from "../Structures/Queue/Song";
import {Queue} from "../Structures/Queue/Queue";
import {Disconnect} from "../Voice/VoiceManager";
import {ClientMessage} from "../../Client";

type EventsQueue = {
    DestroyQueue: (queue: Queue, message: ClientMessage, sendDelQueue?: boolean) => boolean | void,
    pushSong: (song: Song, message: ClientMessage) => void
};
export type Queue_Channels = Queue["channels"];
export type Queue_Options = Queue["options"];

export class QueueEvents extends TypedEmitter<EventsQueue> {
    public constructor() {
        super();
        this.once('DestroyQueue', onDestroyQueue);
        this.on('pushSong', onPushSong);
        this.setMaxListeners(2);
    };

    public destroy = () => {
        this.removeAllListeners();
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Добавляем музыку в очередь
 * @param song {object}
 * @param message {object}
 */
function onPushSong(song: Song, {client, guild}: ClientMessage): void {
    const queue: Queue = client.queue.get(guild.id);

    if (!queue) return;
    queue.songs.push(song);
}
//====================== ====================== ====================== ======================
/**
 * @description Удаление очереди
 * @param queue {object} Очередь сервера
 * @param message {object} Сообщение с сервера
 * @param sendDelQueue {boolean} Отправить сообщение об удалении очереди
 */
function onDestroyQueue(queue: Queue, message: ClientMessage, sendDelQueue: boolean = true): boolean | void {
    if (!queue) return;

    DeleteMessage(queue.channels);
    LeaveVoice(queue?.channels?.message?.guild.id);
    CleanPlayer(queue);
    if (sendDelQueue) SendChannelToEnd(queue.options, message);

    delete queue.songs;
    delete queue.audioFilters;
    delete queue.options;

    delete queue.channels;

    queue.events.queue.destroy();
    queue.events.helper.destroy();
    queue.events.message.destroy();
    delete queue.events;

    return DeleteQueue(message);
}
//====================== ====================== ====================== ======================
/**
 * @description Завершаем воспроизведение в player
 * @param queue {Queue}
 */
function CleanPlayer(queue: Queue): void {
    if (queue.player.state.resource) void queue.player.state.resource.destroy();

    queue.player?.stop();

    setImmediate(() => {
        queue.player?.removeAllListeners();
        queue.player.destroy();
        delete queue.player;
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Отключаемся от голосового канала
 * @param GuildID {string} ID сервера
 */
function LeaveVoice(GuildID: string) {
    return Disconnect(GuildID);
}
//====================== ====================== ====================== ======================

/**
 * @description Удаляем сообщение о текущей песне
 * @param channels {Queue_Channels} Все каналы из очереди
 */
function DeleteMessage({message}: Queue_Channels): NodeJS.Timeout {
    return setTimeout(() => message?.deletable ? message?.delete().catch(() => undefined) : null, 3e3);
}
//====================== ====================== ====================== ======================
/**
 * @description Отправляем сообщение, что музыка завершена
 * @param options {Queue_Options} Опции из очереди
 * @param message {ClientMessage} Сообщение с сервера
 */
function SendChannelToEnd({stop}: Queue_Options, message: ClientMessage): void {
    if (stop) return message.client.Send({text: `🎵 | Музыка была выключена`, message, type: 'css'});
    return message.client.Send({text: `🎵 | Музыка закончилась`, message, type: 'css'});
}
//====================== ====================== ====================== ======================
/**
 * @description Удаляем очередь
 * @param message {ClientMessage} Сообщение с сервера
 */
function DeleteQueue(message: ClientMessage): boolean {

    message.client.console(`[Queue]: [GuildID: ${message.guild.id}, Method: Delete]`);
    return message.client.queue.delete(message.guild.id);
}