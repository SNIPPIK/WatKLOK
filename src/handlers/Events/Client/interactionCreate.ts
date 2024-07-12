import {LightMessageBuilder, MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {CommandInteractionOption, Events} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {locale} from "@lib/locale";
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
                if ((message.user || message?.member?.user).bot || !message?.isCommand()) return;

                //Подменяем данные
                message.author = message?.member?.user ?? message?.user;

                const item = Interaction._stepCommand(message);
                Interaction._stepMessage(item as any, message);
            }
        });
    };

    /**
     * @description Выполняем действия связанные с командами
     * @param message - Взаимодействие с ботом
     * @private
     */
    private static _stepCommand = (message: Client.interact) => {
        const {author} = message;
        const group = db.commands.get([message.commandName, message.options._group]);

        //Если пользователь пытается включить команду вне сервера
        if (!message.guild) return {
            content: locale._(message.locale,"InteractionCreate.guild", [author]),
            color: "DarkRed"
        };

        //Если пользователь пытается использовать команду разработчика
        else if (group?.owner && !db.owners.includes(author.id)) return {
            content: locale._(message.locale,"InteractionCreate.owner", [author]),
            color: "DarkRed"
        };

        else if (!group?.execute) return {
            content: locale._(message.locale,"InteractionCreate.command.null", [author.username]),
            color: "DarkRed",
            codeBlock: "css"
        };

        const options = message.options;
        return group.execute({
            message,
            args: options?._hoistedOptions?.map((f: CommandInteractionOption) => `${f.value}`),
            group: options._group, sub: options._subcommand
        });
    };

    /**
     * @description Отправляем сообщение в текстовый канал
     * @param item - Данные для отправки
     * @param message - Сообщение пользователя
     * @public
     */
    public static _stepMessage = (item: MessageBuilder | LightMessageBuilder["options"] | Promise<MessageBuilder | LightMessageBuilder["options"]>, message: any) => {
        //Если есть данные, то отправляем их в тестовый канал
        if (item) {
            if (!(item instanceof Promise)) {
                if (item instanceof MessageBuilder) (item.send = message);
                else new LightMessageBuilder(item as any).send = message;
            }
            else {
                item.then((data) => {
                    if (item instanceof MessageBuilder) (item.send = message);
                    else new LightMessageBuilder(data as any).send = message;
                }).catch((err) => Logger.log("ERROR", err));
            }
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});