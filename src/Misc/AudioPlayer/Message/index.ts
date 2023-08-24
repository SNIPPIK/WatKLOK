import {ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder} from "discord.js";
import {MessageAction} from "@Embeds/MessageAction";
import { Cycles_Messages } from "@Cycles/Messages";
import { ClientMessage } from "@Client/Message";
import { MessageUtils } from "@Util/Message";
import { Duration } from "@Util/Duration";
import { Queue } from "../Queue/Queue"
import { ISong } from "../Queue/Song";
import { env } from "@env";

const CycleMessages = new Cycles_Messages();
const MusicButtons = JSON.parse(env.get("buttons"));

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
            time: 12e3
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
            time: 12e3
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
            components: [new ActionRowBuilder().addComponents(
                [
                    new ButtonBuilder().setCustomId("last"), new ButtonBuilder().setCustomId("resume_pause"),
                    new ButtonBuilder().setCustomId("skip"), new ButtonBuilder().setCustomId("repeat")
                ].map((d, index) => d.setEmoji(MusicButtons[index]).setStyle(ButtonStyle.Secondary))
            )],
            embeds: [(new ChannelAction.embed(queue)).toJson],
            promise: (msg) => {
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
        if (tracks?.length < 1 || !tracks) return void (MessageUtils.send = { text: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`, color: "DarkRed", message });
        const ChannelAction = new MessageAction<"toSearch">("toSearch"), { client } = message;

        ChannelAction.sendMessage = {
            channel: message.channel,
            components: [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("menu-builder").setPlaceholder("Найденные треки")
                    .setOptions( ...tracks.map((track) => {
                        const duration = isNaN(track.duration.seconds as any) ? track.duration.seconds : Duration.toConverting(parseInt(track.duration.seconds));
                        return { label: `${track.title}`, description: `${track.author.title} | ${duration}`, value: track.url } }), { label: "Отмена", value: "stop" }
                    )
            )],
            embeds: [new ChannelAction.embed(platform).toJson],
            promise: (msg) => {
                //Создаем сборщик
                const collector = msg.createMessageComponentCollector({filter: (interaction) => !interaction.user.bot, time: 30e3, max: 1});
                const clear = () => { MessageUtils.delete = {message: msg}; collector.stop() };

                //Что будет делать сборщик после выбора трека
                collector.once("collect", (interaction: any) => {
                    const id = interaction.values[0];

                    if (id && id !== "stop") {
                        //Ищем команду и выполняем ее
                        const command = client.commands.get("play").execute(message, [id]);
                        if (command) {
                            if ((command instanceof Promise)) command.then((d) => MessageUtils.send = {...d as any, message});
                            else MessageUtils.send = {...command as any, message};
                        }
                    }

                    interaction?.deferReply();
                    interaction?.deleteReply();

                    //Удаляем данные
                    clear();
                });

                //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
                setTimeout(clear, 30e3);
            }
        }
    }
}