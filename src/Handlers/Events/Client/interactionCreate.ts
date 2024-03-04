import {CommandInteractionOption, Events, PermissionsBitField} from "discord.js";
import {Command, Constructor, Event} from "@handler";
import {Client, Logger} from "@Client";
import {db} from "@Client/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
class Interaction extends Constructor.Assign<Event<Events.InteractionCreate>> {
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
                    const item = (status ? Interaction._stepCommand : Interaction._stepButton)(message);

                    //Если есть данные, то отправляем их в тестовый канал
                    if (item) {
                        if (item instanceof Promise) {
                            item.then(data => new Constructor.message({...data, message})).catch((err) => Logger.log("ERROR", err));
                            return;
                        }
                        new Constructor.message({...item as any, message});
                    }
                }
            }
        });
    }

    /**
     * @description Выполняем действия связанные с командами
     * @param message - Взаимодействие с ботом
     * @readonly
     * @private
     */
    private static _stepCommand = (message: Client.interact) => {
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
        const clientPermissions = this._checkPermission(command.permissions, message.channel.permissionsFor(guild.members.me));
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
     * @param message - Взаимодействие с ботом
     * @readonly
     * @private
     */
    private static _stepButton = (message: Client.interact) => {
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
     * @param permissions - Права доступа
     * @param Fields - Где проверять права доступа
     * @readonly
     * @private
     */
    private static _checkPermission = (permissions: Command["permissions"], Fields: Readonly<PermissionsBitField>) => {
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

export default Object.values({Interaction});