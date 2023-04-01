import { ApplicationCommandOptionType, PermissionResolvable, BaseApplicationCommandOptionsData } from "discord.js";
import { ClientInteraction, ClientInteractive, ClientMessage, EmbedConstructor } from "@Client/interactionCreate";

export { replacer, Command, ResolveData, messageUtilsOptions };

/**
 * @description Изменение данных
 */
namespace replacer {
    //Обрезает текст до необходимых значений
    export function replaceText(text: string, value: number | any, clearText: boolean = false): string {
        try {
            if (clearText) text = text.replace(/[\[,\]}{"`'*]()/gi, "");
            if (text.length > value && value !== false) return `${text.substring(0, value)}...`;
            return text;
        } catch { return text; }
    }
}
//====================== ====================== ====================== ======================


/**
 * @description Как выглядит команда
 */
class Command {
    public constructor(options: {
        //Название команды
        name: string;
        //Доп названия для команды
        aliases?: string[];
        //Описание
        description?: string;

        //Как использовать команду
        usage?: string;
        //Права использования
        permissions?: { client: PermissionResolvable[], user: PermissionResolvable[] };
        //Аргументы для слей команд
        options?: InteractiveOptions[];

        //Команда только для разработчиков
        isOwner?: boolean;
        //Преобразовать эту команду в SlashCommand
        isSlash?: boolean;
        //Команда предназначена для сервера
        isGuild?: boolean;
        //Включить команду
        isEnable?: boolean;

        //Ограничение по времени для того что-бы пользователь не спамил командами
        isCLD?: number;
    }) {
        Object.keys(options).forEach((key) => {
            // @ts-ignore
            if (options[key] !== null) this[key] = options[key];
        });
    };
    public readonly run: (message: ClientInteractive, args?: string[]) => Promise<ResolveData> | ResolveData;

    public readonly name: string = null;
    public readonly aliases: string[] = [];
    public readonly description: string = "Нет описания";

    public readonly usage: string = "";
    public readonly permissions: { client: PermissionResolvable[], user: PermissionResolvable[] } = { client: null, user: null };
    public readonly options: InteractiveOptions[] = null;

    public readonly isOwner: boolean = false;
    public readonly isSlash: boolean = true;
    public readonly isGuild: boolean = true;
    public readonly isEnable: boolean = false;

    public readonly isCLD: number = 5;
    public readonly type: string;
}
//====================== ====================== ====================== ======================
/**
 * @description Как выглядит аргумент для SlashCommand
 */
interface InteractiveOptions extends BaseApplicationCommandOptionsData {
    //Название аргумента
    name: string;
    //Описание аргумента
    description: string;
    //Обязательный аргумент?
    required?: boolean;
    //Тип аргумента, можно указать STRING и пользователю придется писать что ему надо
    type: ApplicationCommandOptionType | string;
}
//====================== ====================== ====================== ======================
/**
 * @description Что может выходить из команды
 */
type ResolveData = ResolveEmbed | ResolveText | ResolveMenu;
//====================== ====================== ====================== ======================
/**
 * @description Если команда подразумевает отправление готового EMBED сообщения
 */
interface ResolveEmbed {
    embed: EmbedConstructor;
}
//====================== ====================== ====================== ======================
/**
 * @description Если команда подразумевает отправление текста с некоторыми параметрами
 */
interface ResolveText {
    text: string;
    codeBlock?: "css" | "js" | "ts" | "cpp" | "html" | "cs" | "json" | "not";
    color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number;
    notAttachEmbed?: boolean;
}
//====================== ====================== ====================== ======================
/**
 * @description Если команда подразумевает отправление интерактивного embed меню
 */
interface ResolveMenu {
    embed: EmbedConstructor | string;
    callbacks: any;
}

//====================== ====================== ====================== ======================
/**
 * @description Аргументы для отправления сообщения
 */
interface messageUtilsOptions {
    text: string | EmbedConstructor;
    color?: ResolveText["color"];
    message: ClientMessage | ClientInteraction;
    codeBlock?: ResolveText["codeBlock"];
    notAttachEmbed?: boolean
}
