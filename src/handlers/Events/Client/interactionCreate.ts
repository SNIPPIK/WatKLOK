import {CommandInteractionOption, Events, PermissionsBitField} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
class Interaction extends Constructor.Assign<Handler.Event<Events.InteractionCreate>> {
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            execute: (_, message: any) => {
                //Игнорируем ботов
                if ((message.user || message?.member?.user).bot) return;

                //console.log(message);

                //Подменяем данные
                message.author = message?.member?.user ?? message?.user;

                const status = message?.isCommand() ? true : message?.isButton() ? false : null;

                if (status || status === false) {
                    const item = (status ? Interaction._stepCommand : Interaction._stepButton)(message);

                    //Если есть данные, то отправляем их в тестовый канал
                    if (item) {
                        if (item instanceof Promise) {
                            item.then(data => new Constructor.message<any>({...data, message})).catch((err) => Logger.log("ERROR", err));
                            return;
                        }
                        new Constructor.message<any>({...item as any, message});
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
        const {author, guild} = message;
        const group = db.commands.get([message.commandName, message.options._group]);

        //Если пользователь пытается включить команду вне сервера
        if (!message.guild) return {
            content: `${author}, эта команда предназначена для сервера!`,
            color: "DarkRed"
        };

        //Если пользователь пытается использовать команду разработчика
        else if (group?.owner && !db.owners.includes(author.id)) return {
            content: `${author}, эта команда предназначена для разработчиков!`,
            color: "DarkRed"
        };

        //Проверяем права пользователя
        if (group?.permissions) {
            //Если прав не хватает, то уведомляем пользователя
            const clientPermissions = this._checkPermission(group.permissions, message.channel.permissionsFor(guild.members.me));
            if (clientPermissions) return {
                content: `${author.username}, у меня нет прав на: ${clientPermissions}`,
                color: "DarkRed", codeBlock: "css"
            };
        }

        if (!group?.execute) return { content: `${author.username}, у меня нет этой команды!`, color: "DarkRed", codeBlock: "css" };

        const options = message.options;
        return group.execute({
            message,
            args: options?._hoistedOptions?.map((f: CommandInteractionOption) => `${f.value}`),
            group: options._group, sub: options._subcommand
        });
    };

    /**
     * @description Выполняем действия в зависимости от ID кнопки
     * @param message - Взаимодействие с ботом
     * @readonly
     * @private
     */
    private static _stepButton = (message: Client.interact) => {
        const { author, member, guild } = message;
        const queue = db.audio.queue.get(message.guild.id);

        //Если нет очереди
        if (!queue) return { content: `${author} | Музыка сейчас не играет`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        else if (!member?.voice?.channel || !member?.voice) return { content: `${author} | Необходимо подключиться к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
        };

        switch (message.customId) {
            //Кнопка возврата прошлого трека
            case "last": {
                //Если играет всего один трек
                if (queue.songs.size < 2) return { content: `${message.author}, но играет всего один трек!`, color: "Yellow" };

                else if (queue.songs.length > 1) {
                    const index = 0 ?? queue.songs.length - 1;

                    queue.songs[0] = queue.songs[index];
                    queue.songs[index] = queue.songs.song;
                }

                //Пропускаем текущий трек
                queue.player.stop();
                return { content: `${message.author}, прошлый трек был возвращен!`, color: "Green" };
            }

            //Кнопка перетасовки
            case "shuffle": {
                if (queue.songs.size < 2) return { content: `${message.author}, но играет всего один трек!`, color: "Yellow" };
                queue.shuffle = !queue.shuffle;

                return { content: `${message.author}, перетасовка треков ${queue.shuffle ? "включена" : "выключена"}!`, color: "Green" };
            }

            //Кнопка пропуска
            case "skip": return db.commands.get("queue").execute({message, args: ["1"], sub: "skip"});

            //Кнопка повтора
            case "repeat": {
                const loop = queue.repeat;

                if (loop === "off") {
                    queue.repeat = "songs";
                    return { content: `🔁 | Повтор всей музыки`, codeBlock: "css"};
                } else if (loop === "songs") {
                    queue.repeat = "song";
                    return { content: `🔂 | Повтор  | ${queue.songs[0].title}`, codeBlock: "css"};
                }

                queue.repeat = "off";
                return { content: `❌ | Повтор выключен`, codeBlock: "css"};
            }

            //Кнопка паузы
            case "resume_pause": {
                //Если плеер играет
                if (queue.player.status === "player/playing") return db.commands.get("player").execute({message, sub: "pause"});

                //Если плеер стоит на паузе
                else if (queue.player.status === "player/pause") return db.commands.get("player").execute({message, sub: "resume"});

                //Если статус плеера не совпадает ни с чем
                return { content: `${message.author}, на данном этапе, паузу не возможно поставить!`, color: "Yellow" };
            }
        }

        //Если пользователь нашел не существующую кнопку
        return { content: `${author} | Откуда ты взял эту кнопку!`, color: "DarkRed" }
    };

    /**
     * @description Проверяем права бота и пользователя
     * @param permissions - Права доступа
     * @param Fields - Где проверять права доступа
     * @readonly
     * @private
     */
    private static _checkPermission = (permissions: Handler.Command["permissions"], Fields: Readonly<PermissionsBitField>) => {
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
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});