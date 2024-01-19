import { ActionRow, ActionRowBuilder, Attachment, BaseInteraction, BaseMessageOptions, CommandInteractionOption, EmbedData, Events, GuildMember, Message, MessagePayload, PermissionsBitField, User} from "discord.js";
import {ActionMessage, Event, ICommand} from "@handler";
import {Atlas, Logger} from "@Client";
import {db} from "@Client/db";
/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
export default class extends Event<Events.InteractionCreate> {
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "atlas",
            execute: (_, message: any) => {
                //Игнорируем ботов
                if ((message.user || message?.member?.user).bot) return;

                //Подменяем данные
                message.author = message?.member?.user ?? message?.user;
                const type: number = message?.isCommand() ? 0 : message?.isButton() ? 1 : 2;

                if (type < 2) {
                    const actionType = (type === 0 ? this._stepCommand : this._stepButton)(message);

                    //Если есть что отправить на канал
                    if (actionType) this._sendChannel(message, actionType);
                    return;
                }
            }
        });
    }
    /**
     * @description Выполняем действия связанные с командами
     * @param message {ClientInteraction} Взаимодействие с ботом
     * @readonly
     * @private
     */
    private readonly _stepCommand = (message: ClientInteraction): ICommand.all | Promise<ICommand.all> => {
        const command = db.commands.get(message.commandName);
        const {author, guild} = message;

        //Если пользователь пытается включить команду вне сервера
        if (!message.guild) return {
            content: `${author}, эта команда предназначена для сервера!`,
            color: "DarkRed"
        };

        //Если прав не хватает, то уведомляем пользователя
        const clientPermissions = this._checkPermission(command.permissions as string[], guild.members.me?.permissions);
        if (clientPermissions) return {
            content: `Внимание ${author.tag}\nУ меня нет прав на: ${clientPermissions}`,
            color: "DarkRed", codeBlock: "css"
        };

        //Передаем данные в команду
        const args = message.options?._hoistedOptions?.map((f: CommandInteractionOption) => `${f.value}`);
        const runCommand = command.execute(message, args ?? []);

        if (runCommand) return runCommand;
        return null;
    };

    /**
     * @description Выполняем действия в зависимости от ID кнопки
     * @param message {ClientInteraction} Взаимодействие с ботом
     * @readonly
     * @private
     */
    private readonly _stepButton = (message: ClientInteraction): ICommand.all => {
        const queue = db.music.queue.get(message.guild.id);

        //Если нет очереди
        if (!queue) return { content: `${message.author}, ⚠ | Музыка сейчас не играет`, color: "Yellow" };

        switch (message.customId) {
            //Кнопка возврата прошлого трека
            case "last": {
                //Если играет всего один трек
                if (queue.songs.size === 1) return { content: `${message.author}, но играет всего один трек!`, color: "Yellow" };

                else if (queue.songs.length > 1) {
                    const index = 0 ?? queue.songs.length - 1;

                    queue.songs[0] = queue.songs[index];
                    queue.songs[index] = queue.songs.song;
                }

                //Пропускаем текущий трек
                queue.player.stop();
                return { content: `${message.author}, прошлый трек был возвращен!`, color: "Green" };
            }

            //Кнопка очереди
            case "queue": return db.commands.get("queue").execute(message, ["1"]) as ICommand.all;

            //Кнопка пропуска
            case "skip": return db.commands.get("skip").execute(message, ["1"]) as ICommand.all;

            //Кнопка повтора
            case "repeat": return db.commands.get("repeat").execute(message, [queue.options.loop === "songs" ? "song": "songs"]) as ICommand.all;

            //Кнопка паузы
            case "resume_pause": {
                //Если плеер играет
                if (queue.player.status === "playing") return db.commands.get("pause").execute(message) as ICommand.all;

                //Если плеер стоит на паузе
                else if (queue.player.status === "pause") return db.commands.get("resume").execute(message) as ICommand.all;

                //Если статус плеера не совпадает ни с чем
                return { content: `${message.author}, на данном этапе, паузу не возможно поставить!`, color: "Yellow" };
            }
        }

        //Если пользователь нашел не существующую кнопку
        return { content: `${message.author}, откуда ты взял эту кнопку!`, color: "DarkRed" }
    };

    /**
     * @description Отправляем сообщение в тестовый канал
     * @param message {ClientInteraction} Взаимодействие с ботом
     * @param data {ICommand.all} Тип данных для отправки
     * @readonly
     * @private
     */
    private readonly _sendChannel = (message: ClientInteraction, data: ICommand.all | Promise<ICommand.all>) => {
        if (!(data instanceof Promise)) return void new ActionMessage({...data, message});
        data.then(data => new ActionMessage({...data, message})).catch((err) => Logger.log("ERROR", err));
    };

    /**
     * @description Проверяем права бота и пользователя
     * @param permissions {string[]} Права доступа
     * @param Fields {Readonly<PermissionsBitField>} Где проверять права доступа
     * @readonly
     * @private
     */
    private readonly _checkPermission = (permissions: string[], Fields: Readonly<PermissionsBitField>) => {
        const fail: string[] = [];

        if (permissions && permissions?.length > 0) {
            for (const permission of permissions) {
                if (!Fields.has(permission as any)) fail.push(permission as string);
            }

            return fail.join(", ");
        }

        return null;
    };
}



/**
 *  _____           _                    __
 * |_   _|         | |                  / _|
 *   | |    _ __   | |_    ___   _ __  | |_    __ _   ___    ___   ___
 *   | |   | '_ \  | __|  / _ \ | '__| |  _|  / _` | / __|  / _ \ / __|
 *  _| |_  | | | | | |_  |  __/ | |    | |   | (_| | \__ \ |  __/ \__ \
 * |_____| |_| |_|  \__|  \___| |_|    |_|    \__,_| |___/  \___| |___/
 */



/**
 * @author SNIPPIK
 * @class ClientInteraction
 * @description Структура сообщения с тестового канала вызванная через "/"
 */
// @ts-ignore
export interface ClientInteraction extends BaseInteraction {
    client: Atlas;
    member: GuildMember; customId: string; commandName: string; author: User;
    deferReply: () => Promise<void>; deleteReply: () => Promise<void>;
    options?: {
        _hoistedOptions: any[];
        getAttachment?: (name: string) => Attachment
    };
    reply: ClientMessage["channel"]["send"];
    replied?: boolean;
    followUp: ClientInteraction["reply"];
}

/**
 * @author SNIPPIK
 * @class ClientMessage
 * @description Структура сообщения с текстового канала через <prefix>
 */
// @ts-ignore
export interface ClientMessage extends Message {
    client: Atlas;
    channel: { send(options: SendMessageOptions & { fetchReply?: boolean }): Promise<ClientMessage> };
    edit(content: SendMessageOptions): Promise<ClientMessage>
    reply(options: SendMessageOptions): Promise<ClientMessage>
    user: null;
}

/**
 * @description Аргументы для отправки сообщения
 */
export type SendMessageOptions = string | MessagePayload | BaseMessageOptions | { embeds?: EmbedData[], components?: ActionRow<any> | ActionRowBuilder<any> };