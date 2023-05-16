import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { ClientMessage } from "@Client/Message";
import { MessageCycle } from "@Client/Cycles/Messages";
import { Queue } from "../Queue/Queue"
import { ISong, Song } from "../Queue/Song";
import { EmbedMessages } from "./Embeds";
import { ButtonCollector } from "./ButtonCollector";
import { msgUtil } from "@db/Message";
import { Logger } from "@Logger";
import {env} from "@env";

const MusicButtons = JSON.parse(env.get("buttons"));

if (MusicButtons.length < 4) Error(`[Config]: Buttons has not found, find ${MusicButtons.length}, need 4`);

//Кнопки над сообщением о проигрывании трека
const Buttons = new ActionRowBuilder().addComponents(
    [
        new ButtonBuilder().setCustomId("last").setEmoji(MusicButtons[0]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("resume_pause").setEmoji(MusicButtons[1]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(MusicButtons[2]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("replay").setEmoji(MusicButtons[3]).setStyle(ButtonStyle.Secondary)
    ]
);
const emoji: string = env.get("reaction.emoji.cancel");
const CycleMessages = new MessageCycle();

//Сообщения, которые отправляет плеер
export namespace MessagePlayer {
    /**
     * @description Отправляем сообщение о текущем треке, обновляем раз в 15 сек
     * @param message {ClientMessage} Сообщение
     * @requires {MessageCycle, Message}
     */
    export function toPlay(message: ClientMessage): void {
        const queue: Queue = message.client.player.queue.get(message.guild.id);

        if (!queue || !queue?.song) return;

        setImmediate((): void => {
            const embedCurrentPlaying = EmbedMessages.toPlaying(queue);
            const msg = message.channel.send({ embeds: [embedCurrentPlaying as any], components: [Buttons as any] });

            msg.catch((e) => Logger.error(`[MessagePlayer]: [function: toPlay]: ${e.message}`));
            msg.then((msg) => {
                //Добавляем к сообщению кнопки
                const collector = new ButtonCollector(msg);

                //Удаляем сборщик после проигрывания трека
                queue.player.once("idle", () => collector?.destroy());

                //Добавляем сообщение к CycleStep
                CycleMessages.push = msg;
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description При ошибке плеер выводит эту функцию
     * @param queue {Queue} Очередь
     * @param err {Error | string} Ошибка
     */
    export function toError(queue: Queue, err: Error | string = null): void {
        const { client, channel } = queue.message;

        setImmediate((): void => {
            try {
                const Embed = EmbedMessages.toError(client, queue, err);
                const WarningChannelSend = channel.send({ embeds: [Embed] });

                WarningChannelSend.then(msgUtil.deleteMessage);
            } catch (e) {
                return Logger.error(`[MessagePlayer]: [function: toError]: ${e.message}`);
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Сообщение о добавлении трека в очередь сервера
     * @param queue {Queue} Очередь
     * @param song {Song} Трек
     */
    export function toPushSong(queue: Queue, song: Song): void {
        const { channel } = queue.message;

        setImmediate((): void => {
            try {
                const EmbedPushedSong = EmbedMessages.toPushSong(song, queue);
                const PushChannel = channel.send({ embeds: [EmbedPushedSong] });

                PushChannel.then(msgUtil.deleteMessage);
            } catch (e) {
                return Logger.error(`[MessagePlayer]: [function: toPushSong]: ${e.message}`);
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение о том что плейлист был добавлен в очередь
     * @param message {ClientMessage} Сообщение
     * @param playlist {ISong.playlist} Сам плейлист
     */
    export function toPushPlaylist(message: ClientMessage, playlist: ISong.playlist): void {
        const { channel } = message;

        setImmediate((): void => {
            try {
                const EmbedPushPlaylist = EmbedMessages.toPushPlaylist(message, playlist);
                const PushChannel = channel.send({ embeds: [EmbedPushPlaylist] });

                PushChannel.then(msgUtil.deleteMessage);
            } catch (e) {
                return Logger.error(`[MessagePlayer]: [function: toPushPlaylist]: ${e.message}`);
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Оправляем сообщение о том что было найдено
     * @param tracks {ISong.track[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function toSearch(tracks: ISong.track[], platform: string, message: ClientMessage) {
        const { author, client } = message;

        if (tracks.length < 1) return msgUtil.createMessage({ text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });

        message.channel.send({ embeds: [EmbedMessages.toSearch(tracks, platform, author)] }).then((msg) => {
            //Создаем сборщик
            const collector = msgUtil.createCollector(msg.channel, (m) => {
                const messageNum = parseInt(m.content);
                return !isNaN(messageNum) && messageNum <= tracks.length && messageNum > 0 && m.author.id === author.id;
            });
            const clear = () => { msgUtil.deleteMessage(msg, 1e3); collector?.stop(); }

            //Делаем что-бы при нажатии на эмодзи удалялся сборщик
            msgUtil.createReaction(msg, emoji, (reaction, user) => reaction.emoji.name === emoji && user.id !== client.user.id, clear, 30e3);
            //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
            setTimeout(clear, 30e3);

            //Что будет делать сборщик после нахождения числа
            collector.once("collect", (m: any): void => {
                setImmediate(() => {
                    //Чистим чат и удаляем сборщик
                    msgUtil.deleteMessage(m); clear();

                    //Получаем ссылку на трек, затем включаем его
                    const url = tracks[parseInt(m.content) - 1].url;
                    return client.player.play(message as any, url);
                });
            });
        });
    }
}