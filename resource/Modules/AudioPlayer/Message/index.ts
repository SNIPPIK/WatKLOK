import { ButtonStyle, ComponentType } from "discord.js";
import { MessageCycle } from "@Client/Cycles/Messages";
import { ButtonCollector } from "./Classes/Buttons";
import { MessageAction } from "./Classes/Action";
import { ClientMessage } from "@Client/Message";
import { Queue } from "../Queue/Queue"
import { ISong } from "../Queue/Song";
import { MessageUtils } from "@db/Message";
import { env } from "@env";

//
const emoji: string = env.get("reaction.emoji.cancel");
const CycleMessages = new MessageCycle();
//

//Сообщения, которые отправляет плеер
export namespace PlayerMessage {
    /**
     * @description Сообщение о добавлении трека в очередь сервера
     * @param queue {Queue} Очередь
     */
    export function toPush(queue: Queue) {
        const ChannelAction = new MessageAction<"toPush">("toPush");

        ChannelAction.sendMessage = {
            channel: queue.message.channel,
            embeds: [new ChannelAction.embed(queue).toJson],
            time: 7e3
        };
    }

    /**
     * @description Отправляем сообщение о том что плейлист был добавлен в очередь
     * @param message {ClientMessage} Сообщение
     * @param playlist {ISong.playlist} Сам плейлист
     */
    export function toPushPlaylist(message: ClientMessage, playlist: ISong.playlist) {
        const ChannelAction = new MessageAction<"toPushPlaylist">("toPushPlaylist");

        ChannelAction.sendMessage = {
            channel: message.channel,
            embeds: [new ChannelAction.embed(playlist, message.author).toJson],
            time: 7e3
        };
    }

    /**
     * @description При ошибке плеер выводит эту функцию
     * @param queue {Queue} Очередь
     * @param error {Error | string} Ошибка
     */
    export function toError(queue: Queue, error: string | Error) {
        const ChannelAction = new MessageAction<"toError">("toError");

        ChannelAction.sendMessage = {
            channel: queue.message.channel,
            embeds: [new ChannelAction.embed(queue, error).toJson],
            time: 10e3
        };
    }

    /**
     * @description Отправляем сообщение о текущем треке, обновляем раз в 15 сек
     * @param queue {Queue} Очередь сервера
     */
    export function toPlay(queue: Queue) {
        const ChannelAction = new MessageAction<"toPlay">("toPlay");

        ChannelAction.sendMessage = {
            channel: queue.message.channel,
            components: [ButtonCollector.buttons],
            embeds: [(new ChannelAction.embed(queue)).toJson],
            promise: (msg) => {
                //Добавляем к сообщению кнопки
                const collector = new ButtonCollector(msg);

                //Удаляем сборщик после проигрывания трека
                queue.player.once("idle", () => collector?.destroy());

                //Добавляем сообщение к CycleStep
                CycleMessages.push = msg;
            }
        };
    }

    /**
     * @description Оправляем сообщение о том что было найдено
     * @param tracks {ISong.track[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function toSearch(tracks: ISong.track[], platform: string, message: ClientMessage): void {
        if (tracks.length < 1) return void (MessageUtils.send = { text: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });
        const ChannelAction = new MessageAction<"toSearch">("toSearch"), { author, client } = message;

        ChannelAction.sendMessage = {
            channel: message.channel,
            embeds: [new ChannelAction.embed(tracks, platform).toJson],
            promise: (msg) => {
                //Создаем сборщик
                const collector = MessageUtils.collector(msg.channel, (m: any) => {
                    const messageNum = parseInt(m.content);
                    return !isNaN(messageNum) && messageNum <= tracks.length && messageNum > 0 && m.author.id === author.id;
                }), clear = () => { MessageUtils.delete = {message: msg, time: 1e3}; collector?.stop(); };

                //Делаем что-бы при нажатии на эмодзи удалялся сборщик
                MessageUtils.reaction = {
                    message: msg, emoji, callback: clear, time: 30e3,
                    filter: (reaction, user) => reaction.emoji.name === emoji && user.id !== client.user.id
                };

                //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
                setTimeout(clear, 30e3);

                //Что будет делать сборщик после нахождения числа
                collector.once("collect", (m: any): void => {
                    setImmediate(() => {
                        //Чистим чат и удаляем сборщик
                        MessageUtils.delete = {message: m};

                        //Получаем ссылку на трек, затем включаем его
                        const url = tracks[parseInt(m.content) - 1].url;
                        return client.player.play(message as any, url);
                    });
                });
            }
        }
    }
}