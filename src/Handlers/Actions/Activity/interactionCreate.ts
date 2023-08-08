import { ActionRow, ActionRowBuilder, BaseInteraction,BaseMessageOptions, CommandInteractionOption, DMChannel, EmbedData, Events, GuildMember, Message, MessageEditOptions, MessagePayload, NewsChannel, PartialDMChannel, PermissionsBitField, TextChannel, ThreadChannel, User } from "discord.js";
import { ReactionMenu } from "@Embeds/ReactionMenu";
import { Command, ResolveData } from "@Command";
import { MessageUtils } from "@Util/Message";
import { Duration } from "@Util/Duration";
import { WatKLOK } from "@Client";
import { Action } from "@Action";
import { env } from "@env";

//Exports
export { ClientInteraction, ClientMessage };

//База с пользователями которые слишком часто используют команды
const CoolDownBase = new Map<string, { time: number }>();
const OwnerIDS: string[] = env.get("bot.owners").split(",") || [env.get("bot.owners")];

export default class extends Action {
    public readonly name = Events.InteractionCreate;

    public readonly run = (message: ClientInteraction, client: WatKLOK): void => {
        //Игнорируем ботов
        if ((message.user || message?.member?.user).bot) return;

        //Если это команда, то
        if (message?.isCommand()) return new Interaction(message).runCommand;
        else if (message?.isButton()) {
            const { guild } = message, queue = client.queue.get(guild.id), { player } = queue;

            message.deleteReply().catch(() => undefined); message.deferReply().catch(() => undefined);

            switch (message.customId) {
                case "last": return void (queue.swap = 0);
                case "resume_pause": {
                    switch (queue.player.status) {
                        case "read": return player.pause;
                        case "pause": return player.resume;
                    }
                    break;
                }
                case "skip": {
                    message.client.commands.get("skip").run(message, ["1"]);
                    break;
                }
                case "repeat": {
                    queue.options.loop = queue.options.loop === "songs" ? "song": "songs";
                    break;
                }
            }
        }
    };
}

class Interaction {
    private readonly _message: ClientInteraction;
    /**
     * @description Получаем команду
     */
    private get command() { return this._message.client.commands.get(this._message.commandName) ?? this._message.client.commands.find((cmd: Command) => cmd.aliases.includes(this._message.commandName)); };


    /**
     * @description получаем аргументы пользователя
     * @private
     */
    private get args() { return this._message.options?._hoistedOptions?.map((f: CommandInteractionOption) => `${f.value}`); };


    /**
     * @description Отправляем сообщение в текстовый канал
     * @param command {ResolveData} Данные которые надо отправить
     */
    private set ChannelSend(command: ResolveData) {
        const message = this._message;
        //Запускаем ReactionMenu
        if ("callbacks" in command && command?.callbacks !== undefined) new ReactionMenu(command.embed, message, command.callbacks);

        //Отправляем просто сообщение
        else if ("text" in command) MessageUtils.send = { ...command, message };

        //Отправляем embed
        else MessageUtils.send = { text: command.embed, message };
    };


    /**
     * @description Запускаем команду
     */
    public get runCommand(): void {
        const args = this.args, command = this.command, message = this._message;
        const {author, guild, member} = message;

        //Если нет команды, которую требует пользователь сообщаем ему об этом
        if (!command) return void (this.ChannelSend = { text: `${author}, я не нахожу такой команды!`, color: "DarkRed"});

        //Если команда для разработчика
        if (command.isOwner) {
            //Проверяем пользователь состоит в списке разработчиков
            if (!OwnerIDS.includes(author.id)) return void (this.ChannelSend = { text: `${author}, ты слишком быстро отправляем сообщения! Подожди ${Duration.toConverting(CoolDownBase.get(author.id).time)}`, color: "DarkRed" });
        }

        //Проверяем находится ли пользователь в базе
        if (CoolDownBase.get(author.id) && !OwnerIDS.includes(author.id)) return void (this.ChannelSend ={ text: `${author}, ты слишком быстро отправляем сообщения! Подожди ${Duration.toConverting(CoolDownBase.get(author.id).time)}`, color: "DarkRed" });
        else {
            //Добавляем пользователя в CoolDown базу
            CoolDownBase.set(author.id, { time: command.isCLD });
            setTimeout(() => CoolDownBase.delete(author.id), command.isCLD * 1e3 ?? 5e3);
        }

        //Если пользователь пытается включить команду вне сервера
        if (!message.guild) return void (this.ChannelSend = { text: `${author}, эта команда предназначена для сервера!`, color: "DarkRed"});

        //Проверяем права бота
        const clientPermissions = this.checkPermission(command.permissions.client as string[], guild.members.me?.permissions);

        //Если прав не хватает, то уведомляем пользователя
        if (clientPermissions) return void (this.ChannelSend = { text: `Внимание ${author.tag}\nУ меня нет прав на: ${clientPermissions}`, color: "DarkRed", codeBlock: "css" });

        //Проверяем права пользователя
        const userPermissions = this.checkPermission(command.permissions.user as string[], member?.permissions);

        //Если прав не хватает, то уведомляем пользователя
        if (userPermissions) return void (this.ChannelSend = { text: `Внимание ${author.tag}\nУ тебя нет прав на: ${userPermissions}`, color: "DarkRed", codeBlock: "css" });

        //Передаем данные в команду
        const runCommand = command.run(message, args ?? []);

        //Если есть что отправить на канал
        if (runCommand) {
            if (!(runCommand instanceof Promise)) return void (this.ChannelSend = runCommand);
            runCommand.then(data => this.ChannelSend = data);
        }
    };


    /**
     * @description Проверяем права бота и пользователя
     * @param permissions {string[]} Права доступа
     * @param Fields {Readonly<PermissionsBitField>} Где проверять права доступа
     */
    private readonly checkPermission = (permissions: string[], Fields: Readonly<PermissionsBitField>) => {
        const fail: string[] = [];

        if (permissions && permissions?.length > 0) {
            for (const permission of permissions) {
                if (!Fields.has(permission as any)) fail.push(permission as string);
                else break;
            }

            return fail.join(", ");
        }

        return null;
    };


    /**
     * @description Загружаем данные в класс
     * @param message {ClientInteraction} Взаимодействие с ботом через slash
     */
    public constructor(message: ClientInteraction) {
        message.author = message?.member?.user ?? message?.user;

        this._message = message;
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
    deferReply: () => Promise<void>; deleteReply: () => Promise<void>; options?: { _hoistedOptions: any[] };
    reply: ClientMessage["channel"]["send"];
    replied?: boolean;
    followUp: ClientInteraction["reply"];
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