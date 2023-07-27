import {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedData, StringSelectMenuBuilder} from "discord.js";
import { ClientMessage } from "@Client/Message";
import { MessageCycle } from "@Client/Cycles";
import { MessageUtils } from "@Util/Message";
import {PlayersEmbeds} from "@Embeds/Player";
import { Queue } from "../Queue/Queue"
import { ISong } from "../Queue/Song";
import {Logger} from "@Logger";
import {env} from "@env";
import {Duration} from "@Util/Duration";

//
const CycleMessages = new MessageCycle();
//

/**
 * @description Создаем действие сообщения (что будем делать с сообщением)
 */
class MessageAction<Action> {
    protected _action: Action;

    /**
     * @description Получаем Embed в зависимости от this._action
     */
    public get embed() { // @ts-ignore
        return PlayersEmbeds[this._action]; };


    /**
     * @description Отправляем сообщение
     * @param options {actionOptions} Аргументы для отправки
     */
    public set sendMessage(options: actionOptions) {
        options.channel.send({embeds: options.embeds, components: options.components as any})
            .catch((err: string) => Logger.error(`[AudioPlayer]: [Message]: [${this._action}]: ${err}`))
            .finally(() => { delete this._action; })
            .then((msg) => {
                if (!msg) return;

                if (options.time) MessageUtils.delete = {message: msg, time: options.time};
                if (options.promise) options.promise(msg);
            });
    };

    public constructor(action: Action) { this._action = action; };
}

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
        const MusicButtons = JSON.parse(env.get("buttons"));

        ChannelAction.sendMessage = {
            channel: queue.message.channel,
            components: [new ActionRowBuilder().addComponents(
                [
                    new ButtonBuilder().setCustomId("last").setEmoji(MusicButtons[0]).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("resume_pause").setEmoji(MusicButtons[1]).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("skip").setEmoji(MusicButtons[2]).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("repeat").setEmoji(MusicButtons[3]).setStyle(ButtonStyle.Secondary)
                ]
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
                        const command = client.commands.get("play").run(message, [id]);
                        if (command) {
                            if ((command instanceof Promise)) command.then((d) => MessageUtils.send = {...d as any, message});
                            else MessageUtils.send = {...command as any, message};
                        }
                    }

                    interaction?.deferReply();
                    interaction?.deleteReply();

                    //Удаляем данные
                    return clear();
                });

                //Если пользователь нечего не выбрал, то удаляем сборщик и сообщение через 30 сек
                setTimeout(clear, 30e3);
            }
        }
    }
}

/**
 * @description Аргументы для отправки сообщения
 */
interface actionOptions {
    //Канал на который будет отправлено сообщение
    channel: ClientMessage["channel"];

    //Компоненты, такие как кнопки
    components?: ActionRowBuilder[];

    //Json<EmbedData>
    embeds: EmbedData[];

    //Что будет делать после отправки сообщения
    promise?: (msg: ClientMessage) => void;

    //Время через которое надо удалить сообщение
    time?: number
}