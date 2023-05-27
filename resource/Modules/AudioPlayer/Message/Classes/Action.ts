import {ActionRowBuilder, EmbedData} from "discord.js";
import {ClientMessage} from "@Client/Message";
import {msgUtil} from "@db/Message";
import {EmbedsData} from "./Embed";
import {Logger} from "@Logger";

/**
 * @description Создаем действие сообщения (что будем делать с сообщением)
 */
export class MessageAction<Action> {
    //Название действие, название EmbedData
    private readonly _action: Action;

    /**
     * @description Получаем Embed в зависимости от this._action
     */
    public get embed() { // @ts-ignore
        return EmbedsData[this._action]; };

    /**
     * @description Отправляем сообщение
     * @param options {actionOptions} Аргументы для отправки
     */
    public set sendMessage(options: actionOptions) {
        options.channel.send({embeds: options.embeds, components: options.components as any})
            .catch((err) => Logger.error(`[AudioPlayer]: [Message]: [${this._action}]: ${err}`))
            .then((msg) => {
                if (!msg) return;

                if (options.time) msgUtil.deleteMessage(msg, options.time);
                if (options.promise) options.promise(msg);
            });
    };

    public constructor(action: Action) { this._action = action; };
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