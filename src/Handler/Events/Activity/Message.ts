import {
    ActionRow, ActionRowBuilder,
    ChannelType,
    DMChannel, EmbedData,
    Message,
    MessageEditOptions, MessageOptions, MessagePayload,
    NewsChannel,
    PartialDMChannel,
    TextChannel, ThreadChannel
} from "discord.js";
import {Bot} from '../../../../DataBase/Config.json';
import {WatKLOK} from "../../../Core/Client/Client";
import {DurationUtils} from "../../../AudioPlayer/Manager/DurationUtils";
import ParsingTimeToString = DurationUtils.ParsingTimeToString;
import {CoolDownBase, UtilsPermissions} from "../../../Core/Utils/LiteUtils";
import {Event} from "../../../Structures/Event";

const DefaultPrefix = Bot.prefix; //Префикс

export class messageCreate extends Event<ClientMessage, null>{
    public readonly name = "messageCreate";
    public readonly enable = true;

    public readonly run = (message: ClientMessage) => {
        const {author, client, channel, content} = message;
        if (author.bot || !content.startsWith(DefaultPrefix) || channel.type === ChannelType.DM) return;

        const CoolDownAuthor = CoolDownBase.get(author.id); //Если ли пользователь в базе
        const CommandName = this.#parsingMessageContent(content);
        const Command = client.commands.get(CommandName) ?? client.commands.Array.find(cmd => cmd.aliases.includes(CommandName)); //Сама команда
        const args = content.split(" ").slice(1); //Аргументы к команде

        //Если пользователь является одним из разработчиков, не добавляем его в CoolDown!
        if (UtilsPermissions.isOwner(true, author.id)) {
            //Проверяем находится ли пользователь в базе
            if (CoolDownAuthor) return client.sendMessage({
                text: `${author}, я тебе что квантовый компьютер. Подожди ${ParsingTimeToString(CoolDownAuthor.time)}`,
                message
            });
            else {
                //Добавляем пользователя в CoolDown базу
                CoolDownBase.set(author.id, {time: Command?.CoolDown ?? 5});
                setTimeout(() => CoolDownBase.delete(author.id), (Command?.CoolDown ?? 5) * 1e3 ?? 5e3);
            }
        }

        //Если нет команды
        if (!Command) return client.sendMessage({ text: `${author}, Я не нахожу такой команды, используй ${DefaultPrefix}help  :confused:`, message, color: "RED"});

        //Удаляем сообщение через 12 сек
        setTimeout(() => message.deletable ? message.delete().catch(() => null) : null, 12e3);

        //Если команда предназначена для разработчика
        if (UtilsPermissions.isOwner(Command?.isOwner, author.id)) return client.sendMessage({ text: `${author}, Эта команда не для тебя!`, message, color: "RED"});
        //Если нет прав у пользователя или бота
        if (UtilsPermissions.isPermissions(Command?.permissions, message)) return;

        return Command.run(message, args);
    };
    //Получаем command<name>
    readonly #parsingMessageContent = (content: string) => {
        const ArrayContent = content.split(" ");
        return ArrayContent[0].slice(DefaultPrefix.length).toLowerCase();
    };
}

// @ts-ignore
export interface ClientMessage extends Message {
    client: WatKLOK;
    // @ts-ignore
    edit(content: SendMessageOptions | MessageEditOptions): Promise<ClientMessage>
    // @ts-ignore
    channel: {
        send(options: SendMessageOptions): Promise<ClientMessage>
    } & Channel
}
//Все текстовые каналы
export type Channel = DMChannel | PartialDMChannel | NewsChannel | TextChannel | ThreadChannel;
//ClientMessage<channel>
export type MessageChannel = ClientMessage["channel"];
//Типы для ClientMessage<channel<send>>, ClientMessage<edit>
export type SendMessageOptions = string | MessagePayload | MessageOptions | {embeds?: EmbedConstructor[], components?: ActionRow<any> | ActionRowBuilder<any>};
//Embed JSON
export interface EmbedConstructor extends EmbedData {}
//Цвета, которые есть в базе
export type ColorResolvable = "RED" | "BLUE" | "GREEN" | "DARK" | "YELLOW" | "GREY" | "NAVY" | "GOLD" | "ORANGE" | "PURPLE";