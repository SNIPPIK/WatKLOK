import {ActionRow,ActionRowBuilder,BaseInteraction,BaseMessageOptions,ChannelType,Colors,CommandInteractionOption,DMChannel,EmbedData,GuildMember,Message,MessageEditOptions,MessagePayload,MessageReaction,NewsChannel,PartialDMChannel,TextChannel,ThreadChannel,User} from "discord.js";
import {Command, messageUtilsOptions, ResolveData} from "@Structures/Handle/Command";
import {DurationUtils} from "@Managers/DurationUtils";
import {ReactionMenu} from "@Structures/ReactionMenu";
import {Event} from "@Structures/Handle/Event";
import {WatKLOK} from "@Client/Client";
import {Bot} from '@db/Config.json';

//База с пользователями которые слишком часто используют команды
const CoolDownBase = new Map<string, { time: number }>();

export class interactionCreate extends Event<ClientInteraction, null> {
    public readonly name = "interactionCreate";
    public readonly isEnable = true;

    public readonly run = (message: ClientInteraction) => {
        //Игнорируем ботов
        //Если в сообщении нет префикса или interaction type не команда, то игнорируем
        if (message?.user.bot || message?.member?.user?.bot || message?.isButton() || !message?.isChatInputCommand() || !message?.isRepliable() || !message?.isCommand()) return;
        const args = message.options?._hoistedOptions?.map((f: CommandInteractionOption) => `${f.value}`);
        const command = message.client.commands.get(message.commandName) ?? message.client.commands.find(cmd => cmd.aliases.includes(message.commandName));
        message.author = message?.member?.user ?? message?.user;

        return interactionCreate.runCommand(message, command, args);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запускаем команду
     * @param message {ClientInteractive} Сообщение
     * @param command {Command} Команда
     * @param args {string[]} Аргументы
     */
    public static runCommand = (message: ClientInteractive, command: Command, args: string[] = []): void => {
        const {author} = message;

        //Если нет команды, которую требует пользователь сообщаем ему об этом
        if (!command) return interactionCreate.sendMessage(message, { text: `${author}, Я не нахожу такой команды!`, color: "DarkRed" });
        //Если команду нельзя использовать все сервера
        if (command.isGuild && !message.guild) return interactionCreate.sendMessage(message,{text: `${author}, эта команда не работает вне сервера!`, color: "DarkRed"});

        //Проверяем пользователь состоит в списке разработчиков
        const owner = interactionCreate.checkOwners(author, command);
        //Если есть что сообщить пользователю
        if (owner) return interactionCreate.sendMessage(message, owner);

        //Проверяем права бота и пользователя
        const permissions = interactionCreate.checkPermissions(command, message);
        //Если прав недостаточно сообщаем пользователю
        if (permissions) return interactionCreate.sendMessage(message, permissions);

        //Передаем данные в команду
        const runCommand = command.run(message, args ?? []);

        //Если есть что отправить на канал
        if (runCommand) {
            if (!(runCommand instanceof Promise)) return interactionCreate.sendMessage(message, runCommand);
            runCommand.then((data) => interactionCreate.sendMessage(message, data));
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение
     * @param message {ClientInteractive} Сообщение
     * @param command {ResolveData} Данные для отправки сообщения
     */
    private static sendMessage = (message: ClientInteractive, command: ResolveData): void => {
        //Запускаем ReactionMenu
        if ("callbacks" in command && command?.callbacks !== undefined) new ReactionMenu(command.embed, message, command.callbacks);

        //Отправляем просто сообщение
        else if ("text" in command) UtilsMsg.createMessage({...command, message });

        //Отправляем embed
        else UtilsMsg.createMessage({text: command.embed, message});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем права бота и пользователя
     * @param message {ClientInteractive} Сообщение
     * @param command {Command} Команда
     */
    private static checkPermissions = (command: Command, message: ClientInteractive): ResolveData => {
        const {guild, member, author} = message;
        const permissions = command.permissions;

        //Проверяем нет ли у бота ограничений на права
        if (permissions.client?.length > 0) {
            const ClientString: string[] = [];

            for (let i in permissions.client) {
                if (!guild.members.me?.permissions?.has(permissions.client[i])) ClientString.push(permissions.client[i] as string);
                else break;
            }

            if (ClientString.length > 0) return { text: `Внимание ${author.tag}\nУ меня нет прав на: ${ClientString.join(", ")}`, color: "DarkRed", codeBlock: "css" };
        }

        //Проверяем нет ли у пользователя ограничений на права
        if (permissions.user?.length > 0) {
            const UserString: string[] = [];

            for (let i in permissions.user) {
                if (!member.permissions.has(permissions.user[i])) UserString.push(permissions.user[i] as string);
                else break;
            }

            if (UserString.length > 0) return { text: `Внимание ${author.tag}\nУ тебя нет прав на: ${UserString.join(", ")}`, color: "DarkRed", codeBlock: "css" };
        }
        return;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Если пользователь не входит в состав разработчиков
     * @param author {User} Пользователь
     * @param command {Command} Команда
     */
    private static checkOwners = (author: User, command: Command): ResolveData => {
        if (!Bot.OwnerIDs.includes(author.id)) {
            //Если команда для разработчиков
            if (command.isOwner) return { text: `${author}, Эта команда не для тебя!`, color: "DarkRed" };

            //Проверяем находится ли пользователь в базе
            if (CoolDownBase.get(author.id)) return { text: `${author}, ты слишком быстро отправляем сообщения! Подожди ${DurationUtils.ParsingTimeToString(CoolDownBase.get(author.id).time)}`, color: "DarkRed" }
            else {
                //Добавляем пользователя в CoolDown базу
                CoolDownBase.set(author.id, {time: command.isCLD});
                setTimeout(() => CoolDownBase.delete(author.id), command.isCLD * 1e3 ?? 5e3);
            }
        }
        return;
    };
}

/**
 * @description Взаимодействия с сообщениями
 */
export namespace UtilsMsg {
    /**
     * @description Удаляем сообщение в зависимости от типа
     * @param message {ClientInteractive} Сообщение
     * @param time {number} Через сколько удалить сообщение
     */
    export function deleteMessage(message: ClientInteractive, time: number = 15e3): void {
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
        return channel.createMessageCollector({filter: filter as any, max, time});
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
        const createReactionCollector = () => message.createReactionCollector({filter, time}).on("collect", (reaction: MessageReaction) => callback(reaction));
        message.react(emoji).then(createReactionCollector);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение в тестовый канал по опциям
     * @param options {messageUtilsOptions} Опции для отправления сообщения
     */
    export function createMessage(options: messageUtilsOptions): void {
        const {message} = options;
        const Args = sendArgs(options);
        const channelSend = sendMessage(message, "isButton" in message, Args as any) as Promise<ClientMessage>;

        channelSend.then(deleteMessage);
        channelSend.catch((err: Error) => console.log(`[Discord Error]: [Send message] ${err}`));
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем аргумент сообщения
     * @param options {messageUtilsOptions} Опции для отправления сообщения
     * @private
     */
    function sendArgs(options: messageUtilsOptions): { content: string } | { embeds: [EmbedConstructor] } {
        const {color, text, codeBlock, notAttachEmbed} = options;

        if (typeof text === "string") {
            const description = typeof codeBlock === "string" ? `\`\`\`${codeBlock}\n${text}\n\`\`\`` : text;
            if (!notAttachEmbed) return { embeds: [{ color: typeof color === "number" ? color : Colors[color] ?? 258044, description }]};
            return {content: description};
        }
        return {embeds: [text]};
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Варианты отправления сообщения
     * @param message {ClientInteractive} Сообщение
     * @param isSlash {boolean} Это запрос от пользователя
     * @param args {string} Аргументы для создания сообщения
     * @private
     */
    function sendMessage(message: ClientMessage | ClientInteraction, isSlash: boolean, args: any) {
        if (isSlash) return message.reply({...args, fetchReply: true});
        return message.channel.send({...args, fetchReply: true});
    }
}
/* */
/* */
/* */
/* */
/* */
export type ClientInteractive = ClientMessage | ClientInteraction;
type SendMessageOptions = string | MessagePayload | BaseMessageOptions | { embeds?: EmbedConstructor[], components?: ActionRow<any> | ActionRowBuilder<any> };
// @ts-ignore
export interface ClientMessage extends Message {
    client: WatKLOK;
    channel: { send(options: SendMessageOptions & {fetchReply?: boolean}): Promise<ClientMessage> } & Channels;
    edit(content: SendMessageOptions | MessageEditOptions): Promise<ClientMessage>
    reply(options: SendMessageOptions): Promise<ClientMessage>
    user: null;
}
type Channels = DMChannel | PartialDMChannel | NewsChannel | TextChannel | ThreadChannel;
export interface ClientInteraction extends BaseInteraction {
    client: WatKLOK;
    member: GuildMember; customId: string; commandName: string; commandId: string; author: User;
    //delete: () => void;
    deferReply: () => Promise<void>; deleteReply: () => Promise<void>; options?: { _hoistedOptions: any[] };
    reply: ClientMessage["channel"]["send"];
}
//Embed JSON
export interface EmbedConstructor extends EmbedData {}