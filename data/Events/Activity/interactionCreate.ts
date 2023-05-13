import { ActionRow, ActionRowBuilder, BaseInteraction, BaseMessageOptions, CommandInteractionOption, DMChannel, EmbedData, GuildMember, Message, MessageEditOptions, MessagePayload, NewsChannel, PartialDMChannel, TextChannel, ThreadChannel, User } from "discord.js";
import { ReactionMenu } from "@db/Classes/ReactionMenu";
import { DurationUtils } from "@Utils/Durations";
import { msgUtil } from "@db/Message";
import { Bot } from '@db/Config.json';

//Client imports
import { Command, ResolveData } from "@Client/Command";
import { Event } from "@Client/Event";
import { WatKLOK } from "@Client";

//Exports
export { interactionCreate, ClientInteraction, ClientMessage };

//База с пользователями которые слишком часто используют команды
const CoolDownBase = new Map<string, { time: number }>();

class interactionCreate extends Event<ClientInteraction, null> {
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
     * @param message {ClientMessage | ClientInteraction} Сообщение
     * @param command {Command} Команда
     * @param args {string[]} Аргументы
     */
    public static runCommand = (message: ClientMessage | ClientInteraction, command: Command, args: string[] = []): void => {
        const {author} = message;

        //Если нет команды, которую требует пользователь сообщаем ему об этом
        if (!command) return interactionCreate.sendMessage(message, {
            text: `${author}, я не нахожу такой команды!`,
            color: "DarkRed"
        });
        //Если команду нельзя использовать все сервера
        if (command.isGuild && !message.guild) return interactionCreate.sendMessage(message, {
            text: `${author}, эта команда не работает вне сервера!`,
            color: "DarkRed"
        });

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
     * @param message {ClientMessage | ClientInteraction} Сообщение
     * @param command {ResolveData} Данные для отправки сообщения
     */
    private static sendMessage = (message: ClientMessage | ClientInteraction, command: ResolveData): void => {
        //Запускаем ReactionMenu
        if ("callbacks" in command && command?.callbacks !== undefined) new ReactionMenu(command.embed, message as ClientMessage, command.callbacks);

        //Отправляем просто сообщение
        else if ("text" in command) msgUtil.createMessage({ ...command, message });

        //Отправляем embed
        else msgUtil.createMessage({ text: command.embed, message });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем права бота и пользователя
     * @param message {ClientMessage | ClientInteraction} Сообщение
     * @param command {Command} Команда
     */
    private static checkPermissions = (command: Command, message: ClientMessage | ClientInteraction): ResolveData => {
        const { guild, member, author } = message;
        const permissions = command.permissions;

        //Проверяем нет ли у бота ограничений на права
        if (permissions.client?.length > 0) {
            const ClientString: string[] = [];

            for (const permission of permissions.client) {
                if (!guild.members.me?.permissions?.has(permission)) ClientString.push(permission as string);
                else break;
            }

            if (ClientString.length > 0) return { text: `Внимание ${author.tag}\nУ меня нет прав на: ${ClientString.join(", ")}`, color: "DarkRed", codeBlock: "css" };
        }

        //Проверяем нет ли у пользователя ограничений на права
        if (permissions.user?.length > 0) {
            const UserString: string[] = [];

            for (const permission of permissions.user) {
                if (!member.permissions.has(permission)) UserString.push(permission as string);
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
                CoolDownBase.set(author.id, { time: command.isCLD });
                setTimeout(() => CoolDownBase.delete(author.id), command.isCLD * 1e3 ?? 5e3);
            }
        }
        return;
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Все доступные каналы
 */
type Channels = DMChannel | PartialDMChannel | NewsChannel | TextChannel | ThreadChannel;
//====================== ====================== ====================== ======================
/**
 * @description Структура сообщения с тестового канала вызванная через "/"
 */
interface ClientInteraction extends BaseInteraction {
    client: WatKLOK;
    member: GuildMember; customId: string; commandName: string; commandId: string; author: User;
    //delete: () => void;
    deferReply: () => Promise<void>; deleteReply: () => Promise<void>; options?: { _hoistedOptions: any[] };
    reply: ClientMessage["channel"]["send"];
}
//====================== ====================== ====================== ======================
/**
 * @description Аргументы для отправки сообщения
 */
type SendMessageOptions = string | MessagePayload | BaseMessageOptions | { embeds?: EmbedData[], components?: ActionRow<any> | ActionRowBuilder<any> };
//====================== ====================== ====================== ======================
/**
 * @description Структура сообщения с текстового канала через <prefix>
 */
// @ts-ignore
interface ClientMessage extends Message {
    client: WatKLOK;
    channel: { send(options: SendMessageOptions & { fetchReply?: boolean }): Promise<ClientMessage> } & Channels;
    edit(content: SendMessageOptions | MessageEditOptions): Promise<ClientMessage>
    reply(options: SendMessageOptions): Promise<ClientMessage>
    user: null;
}