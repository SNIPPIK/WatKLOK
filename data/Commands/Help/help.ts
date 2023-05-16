import {ApplicationCommandOptionType, Colors, EmbedData} from "discord.js";
import { Command, ResolveData } from "@Client/Command";
import { ClientMessage } from "@Client/Message";
import { ReactionMenu } from "@db/Classes/ReactionMenu";
import { ArraySort } from "@db/ArraySort";
import {env} from "@env";

const prefix = env.get("bot.prefix")

export class HelpCommand extends Command {
    public constructor() {
        super({
            name: "help",
            aliases: ["h"],
            description: "Можешь глянуть все мои команды!",

            usage: "all | command name",
            options: [
                {
                    name: "command-name-or-all",
                    description: "Укажи название команды, или укажи all для просмотра всех команд",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],

            isGuild: false,
            isSlash: true,
            isEnable: true,

            isCLD: 35
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

        const embed = this.CreateEmbedMessage(message);
        const pages = ArraySort<Command>(5, Commands, (command) =>
            `┌Команда [**${command.name}**] | ${command.type}
             ├ **Сокращения:** (${command.aliases.join(", ") ?? `Нет`})
             ├ **Используется:** ${prefix}${command.name} ${command.usage}
             └ **Описание:** (${command.description ?? `Нет`})`
        );
        embed.description = pages[0];
        embed.footer = { text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL() };

        //Если есть еще страницы, то добавляем им кнопки взаимодействия
        if (pages.length > 1) return { embed, callbacks: ReactionMenu.DefaultCallbacks(1, pages, embed) };
        return { embed };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создает Embed сообщение + pages
     * @param message
     */
    private CreateEmbedMessage = (message: ClientMessage): EmbedData => {
        return {
            title: "Help Menu",
            color: Colors.Yellow,
            thumbnail: { url: message.client.user.avatarURL() },
            timestamp: new Date()
        };
    };
}