import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, CacheType, ComponentType, InteractionCollector, User } from "discord.js";
import { ClientMessage, UtilsMsg } from "@Client/interactionCreate";
import { Music, ReactionMenuSettings } from "@db/Config.json";
import { inPlaylist, inTrack, Song } from "@Queue/Song";
import { MessageCycle } from "@Structures/LifeCycle";
import { Balancer } from "@Structures/Balancer";
import { EmbedMessages } from "./Embeds";
import { Queue } from "@Queue/Queue";
import { Logger } from "@Logger";

export { MessagePlayer };
//====================== ====================== ====================== ======================


if (Music.Buttons.length < 4) Error(`[Config]: Buttons has not found, find ${Music.Buttons.length}, need 4`);

//Кнопки с которыми можно взаимодействовать
const ButtonIDs = ["skip", "resume_pause", "replay", "last"];
//Кнопки над сообщением о проигрывании трека
const Buttons = new ActionRowBuilder().addComponents([
    new ButtonBuilder().setCustomId("last").setEmoji(Music.Buttons[0]).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("resume_pause").setEmoji(Music.Buttons[1]).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("skip").setEmoji(Music.Buttons[2]).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("replay").setEmoji(Music.Buttons[3]).setStyle(ButtonStyle.Secondary)
]
);
const emoji: string = ReactionMenuSettings.emojis.cancel;

//Сообщения, которые отправляет плеер
namespace MessagePlayer {
    /**
     * @description Отправляем сообщение о текущем треке, обновляем раз в 15 сек
     * @param message {ClientMessage} Сообщение
     * @requires {MessageCycle, Message}
     */
    export function toPlay(message: ClientMessage): void {
        //Если уже есть сообщение то удаляем
        MessageCycle.toRemove(message.channelId);
        const queue: Queue = message.client.queue.get(message.guild.id);

        if (!queue?.song) return;

        Balancer.push(() => {
            const embedCurrentPlaying = EmbedMessages.toPlaying(queue);
            const msg = message.channel.send({ embeds: [embedCurrentPlaying as any], components: [Buttons as any] });

            msg.catch((e) => Logger.error(`[MessagePlayer]: [function: toPlay]: ${e.message}`));
            msg.then((msg) => {
                //Добавляем к сообщению кнопки
                const collector = CreateCollector(msg, queue);

                //Удаляем сборщик после проигрывания трека
                queue.player.once("idle", () => collector?.stop());

                //Добавляем сообщение к CycleStep
                MessageCycle.toPush(msg);
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

        Balancer.push(() => {
            try {
                const Embed = EmbedMessages.toError(client, queue, err);
                const WarningChannelSend = channel.send({ embeds: [Embed] });

                WarningChannelSend.then(UtilsMsg.deleteMessage);
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

        Balancer.push(() => {
            try {
                const EmbedPushedSong = EmbedMessages.toPushSong(song, queue);
                const PushChannel = channel.send({ embeds: [EmbedPushedSong] });

                PushChannel.then(UtilsMsg.deleteMessage);
            } catch (e) {
                return Logger.error(`[MessagePlayer]: [function: toPushSong]: ${e.message}`);
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение о том что плейлист был добавлен в очередь
     * @param message {ClientMessage} Сообщение
     * @param playlist {inPlaylist} Сам плейлист
     */
    export function toPushPlaylist(message: ClientMessage, playlist: inPlaylist): void {
        const { channel } = message;

        Balancer.push(() => {
            try {
                const EmbedPushPlaylist = EmbedMessages.toPushPlaylist(message, playlist);
                const PushChannel = channel.send({ embeds: [EmbedPushPlaylist] });

                PushChannel.then(UtilsMsg.deleteMessage);
            } catch (e) {
                return Logger.error(`[MessagePlayer]: [function: toPushPlaylist]: ${e.message}`);
            }
        });
    }
    /**
     * @description Оправляем сообщение о том что было найдено
     * @param tracks {inTracks[]} Найденные треки
     * @param platform {platform} Платформа на которой ищем
     * @param message {ClientMessage} Сообщение с сервера
     * @returns 
     */
    export function toSearch(tracks: inTrack[], platform: string, message: ClientMessage) {
        const { author, client } = message;

        if (tracks.length < 1) return UtilsMsg.createMessage({ text: `${author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });

        message.channel.send({ embeds: [EmbedMessages.toSearch(tracks, platform, author)] }).then((msg) => {
            //Создаем сборщик
            const collector = UtilsMsg.createCollector(msg.channel, (m) => {
                const messageNum = parseInt(m.content);
                return !isNaN(messageNum) && messageNum <= tracks.length && messageNum > 0 && m.author.id === author.id;
            });
            const clear = () => { UtilsMsg.deleteMessage(msg, 1e3); collector?.stop(); }

            //Делаем что-бы при нажатии на эмодзи удалялся сборщик
            UtilsMsg.createReaction(msg, emoji, (reaction, user) => reaction.emoji.name === emoji && user.id !== client.user.id, clear, 30e3);
            //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
            setTimeout(clear, 30e3);

            //Что будет делать сборщик после нахождения числа
            collector.once("collect", (m: any): void => {
                setImmediate(() => {
                    //Чистим чат и удаляем сборщик
                    UtilsMsg.deleteMessage(m); clear();

                    //Получаем ссылку на трек, затем включаем его
                    const url = tracks[parseInt(m.content) - 1].url;
                    return client.player.play(message as any, url);
                });
            });
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем сборщик кнопок
 * @param message {ClientMessage} Сообщение
 * @param queue {Queue} Очередь сервера
 */
function CreateCollector(message: ClientMessage, queue: Queue): InteractionCollector<ButtonInteraction<CacheType>> {
    //Создаем сборщик кнопок
    const collector = message.createMessageComponentCollector({ filter: (i) => ButtonIDs.includes(i.customId), componentType: ComponentType.Button, time: 60e5 });
    const { player } = queue;
    const EmitPlayer = message.client.player;

    //Добавляем ему ивент сборки кнопок
    collector.on("collect", (i): void => {
        message.author = i?.member?.user as User ?? i?.user;
        try { i.deferReply(); i.deleteReply(); } catch (e) {/*Notfing*/ }

        //Если вдруг пользователь будет нажимать на кнопки после выключения плеера
        if (!player?.state || !player?.state?.status) return;

        switch (i.customId) {
            case "resume_pause": { //Если надо приостановить музыку или продолжить воспроизведение
                switch (player.state.status) {
                    case "read": return void EmitPlayer.pause(message);
                    case "pause": return void EmitPlayer.resume(message);
                }
                return;
            }
            //Пропуск текущей музыки
            case "skip": return void EmitPlayer.skip(message, 1);
            //Повторно включить текущую музыку
            case "replay": return void EmitPlayer.replay(message);
            //Включить последнею из списка музыку
            case "last": return queue?.swapSongs();
        }
    });

    return collector;
}