import { BaseApplicationCommandOptionsData, PermissionResolvable, ApplicationCommandOptionType, EmbedData, ApplicationCommandOption } from "discord.js";
import {ClientInteraction, ClientMessage} from "@Client/Message";
import {colors} from "@Util/Message";

/**
 * @description Как выглядит команда
 */
export abstract class Command {
    protected constructor(options: {
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
        options?: ApplicationCommandOption[];

        //Команда только для разработчиков
        isOwner?: boolean;

        //Ограничение по времени
        cooldown?: number;
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

    public isOwner: boolean = false;

    public readonly isCLD: number = 5;
    public type: string;
}


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
    embed: EmbedData | string;
    callbacks: any;
} | { //Готовое embed сообщение
    embed: EmbedData;
};
