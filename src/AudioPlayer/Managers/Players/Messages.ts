import {ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message, User} from "discord.js";
import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {MessageCycle} from "@Managers/Players/CycleStep";
import {EmbedMessages} from "@Structures/EmbedMessages";
import {InputPlaylist, Song} from "@Queue/Song";
import {consoleTime} from "@Client/Client";
import {Music} from "@db/Config.json";
import {Queue} from "@Queue/Queue";

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

//Сообщения, которые отправляет плеер
export namespace MessagePlayer {
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

        setImmediate(() => {
            const embedCurrentPlaying = EmbedMessages.toPlaying(message.client, queue);
            const msg = message.channel.send({embeds: [embedCurrentPlaying as any], components: [Buttons as any]});

            msg.catch((e) => console.log(`[MessagePlayer]: [function: toPlay]: ${e.message}`));
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
        const {client, channel} = queue.message;

        setImmediate(() => {
            try {
                const Embed = EmbedMessages.toError(client, queue, err);
                const WarningChannelSend = channel.send({embeds: [Embed]});

                WarningChannelSend.then(UtilsMsg.deleteMessage);
            } catch (e) {
                return consoleTime(`[MessagePlayer]: [function: toError]: ${e.message}`);
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
        const {client, channel} = queue.message;

        setImmediate(() => {
            try {
                const EmbedPushedSong = EmbedMessages.toPushSong(client, song, queue);
                const PushChannel = channel.send({embeds: [EmbedPushedSong]});

                PushChannel.then(UtilsMsg.deleteMessage);
            } catch (e) {
                return consoleTime(`[MessagePlayer]: [function: toPushSong]: ${e.message}`);
            }
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение о том что плейлист был добавлен в очередь
     * @param message {ClientMessage} Сообщение
     * @param playlist {InputPlaylist} Сам плейлист
     */
    export function toPushPlaylist(message: ClientMessage, playlist: InputPlaylist): void {
        const {channel} = message;

        setImmediate(() => {
            try {
                const EmbedPushPlaylist = EmbedMessages.toPushPlaylist(message, playlist);
                const PushChannel = channel.send({embeds: [EmbedPushPlaylist]});

                PushChannel.then(UtilsMsg.deleteMessage);
            } catch (e) {
                return consoleTime(`[MessagePlayer]: [function: toPushPlaylist]: ${e.message}`);
            }
        });
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем сборщик кнопок
 * @param message {ClientMessage} Сообщение
 * @param queue {Queue} Очередь сервера
 */
function CreateCollector(message: ClientMessage, queue: Queue) {
    //Создаем сборщик кнопок
    const collector = message.createMessageComponentCollector({ filter: (i) => ButtonIDs.includes(i.customId), componentType: ComponentType.Button, time: 60e5 });
    const {player} = queue;
    const EmitPlayer = message.client.player;

    //Добавляем ему ивент сборки кнопок
    collector.on("collect", (i): void => {
        message.author = i?.member?.user as User ?? i?.user;
        try { i.deferReply(); i.deleteReply(); } catch (e) {/*Notfing*/}

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