import { ActionRow, ActionRowBuilder, Attachment, BaseInteraction, BaseMessageOptions, CommandInteractionOption, EmbedData, Events, GuildMember, Message, MessagePayload, PermissionsBitField, User} from "discord.js";
import {ActionMessage, Assign, Command, Event} from "@handler";
import {Atlas, Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";
/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
export default class extends Assign<Event<Events.InteractionCreate>> {
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            execute: (_, message: any) => {
                //Игнорируем ботов
                if ((message.user || message?.member?.user).bot) return;

                //Подменяем данные
                message.author = message?.member?.user ?? message?.user;

                const status = message?.isCommand() ? true : message?.isButton() ? false : null;

                if (status || status === false) {
                    const item = (status ? this._stepCommand : this._stepButton)(message);

                    //Если есть данные, то отправляем их в тестовый канал
                    if (item) {
                        if (!(item instanceof Promise)) return void new ActionMessage({...item as any, message});
                        item.then(data => new ActionMessage({...data, message})).catch((err) => Logger.log("ERROR", err));
                    }
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
    private _stepCommand = (message: ClientInteraction) => {
        const owners: string[] = env.get("owner.list").split(",");
        const command = db.commands.get(message.commandName);
        const {author, guild} = message;

        //Если пользователь пытается включить команду вне сервера
        if (!message.guild) return {
            content: `${author}, эта команда предназначена для сервера!`,
            color: "DarkRed"
        };

        //Если пользователь пытается использовать команду разработчика
        else if (command?.owner && !owners.includes(author.id)) return {
            content: `${author}, эта команда предназначена для разработчиков!`,
            color: "DarkRed"
        };

        //Если прав не хватает, то уведомляем пользователя
        const clientPermissions = this._checkPermission(command.permissions, guild.members.me?.permissions);
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
    private _stepButton = (message: ClientInteraction) => {
        const queue = db.queue.get(message.guild.id);

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
            case "queue": return db.commands.get("queue").execute(message);

            //Кнопка пропуска
            case "skip": return db.commands.get("skip").execute(message, ["1"]);

            //Кнопка повтора
            case "repeat": return db.commands.get("repeat").execute(message, [queue.loop === "songs" ? "song": "songs"]);

            //Кнопка паузы
            case "resume_pause": {
                //Если плеер играет
                if (queue.player.status === "player/playing") return db.commands.get("pause").execute(message);

                //Если плеер стоит на паузе
                else if (queue.player.status === "player/pause") return db.commands.get("resume").execute(message);

                //Если статус плеера не совпадает ни с чем
                return { content: `${message.author}, на данном этапе, паузу не возможно поставить!`, color: "Yellow" };
            }
        }

        //Если пользователь нашел не существующую кнопку
        return { content: `${message.author}, откуда ты взял эту кнопку!`, color: "DarkRed" }
    };

    /**
     * @description Проверяем права бота и пользователя
     * @param permissions {string[]} Права доступа
     * @param Fields {Readonly<PermissionsBitField>} Где проверять права доступа
     * @readonly
     * @private
     */
    private _checkPermission = (permissions: Command["permissions"], Fields: Readonly<PermissionsBitField>) => {
        const fail: any[] = [];

        if (permissions && permissions?.length > 0) {
            for (const permission of permissions) {
                if (!Fields.has(permission)) fail.push(permission);
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