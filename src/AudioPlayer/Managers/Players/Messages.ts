import {ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message, User} from "discord.js";
import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {MessageCycle} from "@Managers/Players/CycleStep";
import {EmbedMessages} from "@Structures/EmbedMessages";
import {InputPlaylist, Song} from "@Queue/Song";
import {consoleTime} from "../../../Client/Client";
import {Queue} from "@Queue/Queue";

//Кнопки с которыми можно взаимодействовать
const ButtonIDs = ["skip", "resume_pause", "replay", "last"];

//Сообщения, которые отправляет плеер
export namespace MessagePlayer {
    /**
     * @description Отправляем сообщение о текущем треке, обновляем раз в 15 сек
     * @param message {ClientMessage} Сообщение
     * @requires {MessageCycle, pushCurrentSongMessage, Message}
     */
    export function toPlay(message: ClientMessage) {
        //Если уже есть сообщение то удаляем
        MessageCycle.toRemove(message.channelId);

        setImmediate(() => {
            const msg = pushCurrentSongMessage(message);

            if (msg) msg.then(MessageCycle.toPush).catch(console.log);
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description При ошибке плеер выводит эту функцию
     * @param queue {Queue} Очередь
     * @param err {Error | string} Ошибка
     */
    export function toError(queue: Queue, err: Error | string = null) {
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
    export function toPushSong(queue: Queue, song: Song) {
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
    export function toPushPlaylist(message: ClientMessage, playlist: InputPlaylist) {
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
 * @description Отправляем сообщение
 * @param message {ClientMessage} Сообщение
 * @requires {CreateCollector}
 */
function pushCurrentSongMessage(message: ClientMessage): Promise<ClientMessage> {
    const queue: Queue = message.client.queue.get(message.guild.id);

    if (!queue?.song) return;

    const CurrentPlayEmbed = EmbedMessages.toPlay(message.client, queue);
    //Кнопки над сообщением о проигрывании трека
    const Buttons = new ActionRowBuilder().addComponents([
        new ButtonBuilder().setCustomId("last").setEmoji({id: "986009800867479572"}).setStyle(ButtonStyle.Secondary), //id: "986009800867479572" или name: "⏪"
        new ButtonBuilder().setCustomId("resume_pause").setEmoji({id: "986009725432893590"}).setStyle(ButtonStyle.Secondary), //id: "986009725432893590" или name: "⏯"
        new ButtonBuilder().setCustomId("skip").setEmoji({id: "986009774015520808"}).setStyle(ButtonStyle.Secondary), //id: "986009774015520808" или name: "⏩"
        new ButtonBuilder().setCustomId("replay").setEmoji({id: "986009690716667964"}).setStyle(ButtonStyle.Secondary)] //id: "986009690716667964" или name: "🔃"
    );

    const sendMessage = message.channel.send({embeds: [CurrentPlayEmbed as any], components: [Buttons as any]});

    sendMessage.then((msg) => CreateCollector(msg, queue)); //Добавляем к сообщению кнопки
    sendMessage.catch((e) => console.log(`[MessageEmitter]: [function: pushCurrentSongMessage]: ${e.message}`));

    return sendMessage;
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

    //Удаляем сборщик после проигрывания трека
    player.once("idle", () => collector.stop());

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