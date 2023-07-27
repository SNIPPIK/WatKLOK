import {ApplicationCommandOptionType, Colors} from "discord.js";
import { ReactionMenu } from "@Embeds/ReactionMenu";
import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";
import { ArraySort } from "@Util/ArraySort";

export default class extends Command {
    public constructor() {
        super({
            name: "help",
            aliases: ["h"],
            description: "Можешь глянуть все мои команды!",

            usage: "all | command name",
            options: [
                {
                    name: "query",
                    description: "Необходимо указать имя команды или all",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],
            cooldown: 35
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, client } = message;
        const Arg = args[args.length - 1]?.toLowerCase();

        const Commands: Command[] = client.commands.filter((command: Command) => {
            if (!Arg || Arg === "all") return !command.isOwner;
            else return command.name === Arg || command.aliases.includes(Arg);
        }).toJSON();

        //Если пользователь хочет получить данные о не существующей команде
        if (!Commands?.length) return { text: `${author}, у меня нет такой команды!`, color: "Yellow" };

        //Создаем странички
        const pages = ArraySort<Command>(5, Commands, (command) =>
            `┌Команда [**${command.name}**] | ${command.type}
             ├ **Сокращения:** (${command.aliases.join(", ") ?? `Нет`})
             ├ **Используется:** ${command.name} ${command.usage}
             └ **Описание:** (${command.description ?? `Нет`})`
        );

        //Создаем EMBED
        const embed = {
            title: "Help Menu", description: pages[0], color: Colors.Yellow,
            thumbnail: { url: message.client.user.avatarURL() },
            timestamp: new Date(),
            footer: { text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL() }
        }

        //Если есть еще страницы, то добавляем им кнопки взаимодействия
        if (pages.length > 1) return { embed, callbacks: ReactionMenu.DefaultCallbacks(1, pages, embed) };
        return { embed, lifeTime: 20e3 };
    };

}