import { ClientInteraction, ClientMessage } from "@Client/Message";
import {Colors, EmbedData, MessageReaction, User} from "discord.js";


export class MessageUtils {
    public static set delete(options: {message: ClientMessage | ClientInteraction, time?: number}) {
        const {message, time} = options;

        //Удаляем сообщение
        if ("deletable" in message && message.deletable) {
            setTimeout(() => message.delete().catch(() => {}), time ?? 15e3);

            //Удаляем ответ пользователю
        } else if ("isRepliable" in message && message.isRepliable()) {
            setTimeout(() => message.deleteReply().catch(() => {}), time ?? 15e3);
        }
    };

    public static set reaction(options: createReaction) {
        const {message, time, filter, callback, emoji} = options;

        message.react(emoji).then(() => message.createReactionCollector({ filter, time }).on("collect", (reaction: MessageReaction) => callback(reaction)));
        this.delete = {message, time: time ?? 35e3};
    };

    public static set send(options: send) {
        const {message} = (options as send);
        const Args = sendArgs(options);
        const channelSend = sendMessage(message, "isButton" in message, Args as any) as Promise<ClientMessage>;

        channelSend.then((msg) => {this.delete = {message: msg}});
        channelSend.catch((e) => console.log(`[Discord Error]: [Send message] ${e}`));
    };

    public static get collector() {
        return (channel: ClientMessage["channel"], filter: (m: ClientMessage) => boolean, max: number = 1, time: number = 20e3) =>
            channel.createMessageCollector({ filter: filter as any, max: max, time: time });
    };
}


/**
 * @description Доступные цвета для Embed
 */
export type colors = "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;

interface send {
    text: string | EmbedData;
    color?: colors;
    message: ClientMessage | ClientInteraction;
    codeBlock?: string;
    notAttachEmbed?: boolean
}
interface createReaction {
    message: ClientMessage;
    emoji: string;
    filter: (reaction: MessageReaction, user: User) => boolean;
    callback: (reaction: MessageReaction) => any;
    time?: number
}

interface createReaction {
    message: ClientMessage;
    emoji: string;
    filter: (reaction: MessageReaction, user: User) => boolean;
    callback: (reaction: MessageReaction) => any;
    time?: number
}

//====================== ====================== ====================== ======================
/**
 * @description Создаем аргумент сообщения
 * @param options {send} Опции для отправления сообщения
 */
function sendArgs(options: send): { content: string } | { embeds: [EmbedData] } {
    const { color, text, codeBlock, notAttachEmbed } = options;

    if (typeof text === "string") {
        const description = codeBlock ? `\`\`\`${codeBlock}\n${text}\n\`\`\`` : text;
        if (!notAttachEmbed) return { embeds: [{ color: typeof color === "number" ? color : Colors[color] ?? 258044, description }] };
        return { content: description };
    }

    return { embeds: [text] };
}
//====================== ====================== ====================== ======================
/**
 * @description Варианты отправления сообщения
 * @param message {ClientMessage | ClientInteraction} Сообщение
 * @param isSlash {boolean} Это запрос от пользователя
 * @param args {string} Аргументы для создания сообщения
 */
function sendMessage(message: ClientMessage | ClientInteraction, isSlash: boolean, args: any) {
    try {
        if (isSlash && (message as ClientInteraction).isRepliable()) return message.reply({...args, fetchReply: true});
        return (message as ClientMessage).channel.send({...args, fetchReply: true});
    } catch (e) {
        console.log(`[Discord Error]: [Send message] ${e}`);
    }
}