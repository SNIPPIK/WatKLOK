import { ClientInteraction, ClientMessage, EmbedConstructor } from "@Client/Message";
import { Colors, MessageReaction, User } from "discord.js";

/**
 * @description Доступные цвета для Embed
 */
export type colors = "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
//====================== ====================== ====================== ======================
/**
 * @description Взаимодействия с сообщениями
 */
export namespace UtilsMsg {
    /**
     * @description Удаляем сообщение в зависимости от типа
     * @param message {ClientMessage | ClientInteraction} Сообщение
     * @param time {number} Через сколько удалить сообщение
     */
    export function deleteMessage(message: ClientMessage | ClientInteraction, time: number = 15e3): void {
        //Удаляем сообщение
        if ("deletable" in message) setTimeout(() => message.deletable ? message.delete().catch(() => null) : null, time);

        //Удаляем ответ пользователю
        else if ("isRepliable" in message) setTimeout(() => message.isRepliable() ? message.deleteReply().catch((): null => null) : null, time);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем сборщик сообщений
     * @param channel {ClientMessage["channel"]} Канал на котором будет создан сборщик
     * @param filter {Function} Как фильтровать сообщения
     * @param max {number} Сколько раз можно уловить сообщение
     * @param time {number} Через сколько удалить сообщение
     */
    export function createCollector(channel: ClientMessage["channel"], filter: (m: ClientMessage) => boolean, max: number = 1, time: number = 20e3) {
        return channel.createMessageCollector({ filter: filter as any, max, time });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем реакцию к сообщению + сборщик реакций
     * @param message {ClientMessage} Сообщение
     * @param emoji {string} Реакция
     * @param filter {Function} Как фильтровать сообщения
     * @param callback {Function} Что делать при нажатии на реакцию
     * @param time {number} Через сколько удалить сообщение
     */
    export function createReaction(message: ClientMessage, emoji: string, filter: (reaction: MessageReaction, user: User) => boolean, callback: (reaction: MessageReaction) => any, time = 35e3): void {
        deleteMessage(message, time);
        const createReactionCollector = () => message.createReactionCollector({ filter, time }).on("collect", (reaction: MessageReaction) => callback(reaction));
        message.react(emoji).then(createReactionCollector);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение в тестовый канал по опциям
     * @param options {messageUtilsOptions} Опции для отправления сообщения
     */
    export function createMessage(options: messageUtilsOptions): void {
        const { message } = options;
        const Args = sendArgs(options);
        const channelSend = sendMessage(message, "isButton" in message, Args as any) as Promise<ClientMessage>;

        channelSend.then(deleteMessage);
        channelSend.catch((err: Error) => console.log(`[Discord Error]: [Send message] ${err}`));
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Создаем аргумент сообщения
 * @param options {messageUtilsOptions} Опции для отправления сообщения
 * @private
 */
function sendArgs(options: messageUtilsOptions): { content: string } | { embeds: [EmbedConstructor] } {
    const { color, text, codeBlock, notAttachEmbed } = options;

    if (typeof text === "string") {
        const description = typeof codeBlock === "string" ? `\`\`\`${codeBlock}\n${text}\n\`\`\`` : text;
        if (!notAttachEmbed) {
            const embed: EmbedConstructor = { color: typeof color === "number" ? color : Colors[color] ?? 258044, description };

            return { embeds: [embed] };
        }
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
 * @private
 */
function sendMessage(message: ClientMessage | ClientInteraction, isSlash: boolean, args: any) {
    if (isSlash) return message.reply({ ...args, fetchReply: true });
    return (message as ClientMessage).channel.send({ ...args, fetchReply: true });
}
//====================== ====================== ====================== ======================
/**
 * @description Аргументы для отправления сообщения
 */
interface messageUtilsOptions {
    text: string | EmbedConstructor;
    color?: colors;
    message: ClientMessage | ClientInteraction;
    codeBlock?: string;
    notAttachEmbed?: boolean
}