import { ClientMessage } from "@Client/Message";
import { ReactionMenuSettings } from "@db/Config.json";
import {EmbedData, MessageReaction, User} from "discord.js";
import { msgUtil } from "@db/Message";

const emojis = ReactionMenuSettings.emojis;

interface ReactionCallbacks {
    back: (reaction: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage) => void;
    next: (reaction: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage) => void;
    cancel: (reaction: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage) => void;
}

export class ReactionMenu {
    public constructor(embed: EmbedData | string, message: ClientMessage, callbacks: ReactionCallbacks, isSlash: boolean = false) {
        const args = typeof embed === "string" ? { content: embed, fetchReply: true } : { embeds: [embed], fetchReply: true };

        setImmediate(() => (isSlash ? message.reply : message.channel.send)(args).then((msg) => this.createReactions(msg, message, callbacks)));
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем реакции под сообщением
     * @param msg {ClientMessage} Сообщение бота
     * @param message {ClientMessage} Сообщение пользователя
     * @param callbacks {ReactionCallbacks} Что делать при взаимодействии с реакциями
     * @returns 
     */
    private readonly createReactions = (msg: ClientMessage, message: ClientMessage, callbacks: ReactionCallbacks) => Object.entries(callbacks).forEach(([key, value]) => {
        const callback = (reaction: MessageReaction) => value(reaction, message.author, message, msg);
        const emoji = emojis[key as "back" | "next" | "cancel"];

        return msgUtil.createReaction(msg, emoji, (reaction, user) => reaction.emoji.name === emoji && user.id !== message.client.user.id, callback, 60e3);
    });
    //====================== ====================== ====================== ======================
    /**
     * @description Функции для управления <CollectorSortReaction>
     * @param page {number} С какой страницы начнем
     * @param pages {Array<string>} страницы
     * @param embed {EmbedData} Json<Embed>
     */
    public static DefaultCallbacks = (page: number, pages: string[], embed: EmbedData): ReactionCallbacks => {
        return {
            //При нажатии на 1 эмодзи, будет выполнена эта функция
            back: ({ users }: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    users.remove(user).catch((err) => console.log(err));

                    if (page === 1 || !msg.editable) return null;
                    page--;
                    embed = { ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}` } };

                    return msg.edit({ embeds: [embed] });
                });
            },
            //При нажатии на 2 эмодзи, будет выполнена эта функция
            cancel: (reaction: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    [msg, message].forEach((mes) => mes.deletable ? mes.delete().catch(() => null) : null);
                });
            },
            //При нажатии на 3 эмодзи, будет выполнена эта функция
            next: ({ users }: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    users.remove(user).catch((err) => console.log(err));

                    if (page === pages.length || !msg.editable) return null;
                    page++;
                    embed = { ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}` } };

                    return msg.edit({ embeds: [embed] });
                });
            }
        };
    }
}