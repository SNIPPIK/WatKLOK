import { ApplicationCommandOptionType, PermissionResolvable, BaseApplicationCommandOptionsData } from "discord.js";
import { ClientInteraction, ClientMessage, EmbedConstructor } from "@Client/Message";
import { colors } from "@Utils/Message";
import { WatKLOK } from "@Client";

/**
 * @description Класс для событий
 */
export class Event<K, P> {
    //Название ивента Discord.<Client>
    public readonly name: string = "undefined";

    //Загружать ли ивент
    public readonly isEnable: boolean = false;

    //Функция, которая будет запущена при вызове ивента
    public readonly run: (f: K, f2: P, client: WatKLOK) => void;
}
//====================== ====================== ====================== ======================
/**
 * @description Как выглядит команда
 */
export class Command {
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

        //Ограничение по времени
        isCLD?: number;
    }) {
        Object.keys(options).forEach((key) => {
            // @ts-ignore
            if (options[key] !== null) this[key] = options[key];
        });
    };
    public readonly run: (message: ClientMessage | ClientInteraction, args?: string[]) => Promise<ResolveData> | ResolveData;

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
export type ResolveData =
    { //Стандарт
        text: string;
        codeBlock?: "css" | "js" | "ts" | "cpp" | "html" | "cs" | "json" | "not";
        color?: colors;
        notAttachEmbed?: boolean;
    } | { //ReactionMenu
        embed: EmbedConstructor | string;
        callbacks: any;
    } | { //Готовое embed сообщение
        embed: EmbedConstructor;
    };
