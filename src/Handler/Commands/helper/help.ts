import {ClientMessage, EmbedConstructor} from "@Client/interactionCreate";
import {Command, ResolveData} from "@Structures/Handle/Command";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {ArraySort} from "@Structures/ArraySort";
import {ReactionMenu} from "@Structures/ReactionMenu";
import {Bot} from "@db/Config.json";

export class Command_Help extends Command {
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
        const {author, client} = message;
        const Arg = args[args.length - 1];
        const Commands: Command[] = client.commands.filter((command: Command) => Arg !== "all" ? command.name === Arg || command.aliases.includes(Arg) : !command.isOwner).values() as any;

        //Если пользователь хочет получить данные о не существующей команде
        if (!Commands?.length) return {text: `${author}, у меня нет такой команды!`};

        const embed = this.CreateEmbedMessage(message);
        const pages = ArraySort<Command>(5, Commands, (command) =>
            `┌Команда [**${command.name}**] | ${command.type}
             ├ **Сокращения:** (${command.aliases.join(", ") ?? `Нет`})
             ├ **Описание:** (${command.description ?? `Нет`})
             └ **Используется:** ${Bot.prefix}${command.name} ${command.usage}`
        );
        embed.description = pages[0];
        embed.footer = {text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL()};

        //Если есть еще страницы, то добавляем им кнопки взаимодействия
        if (pages.length > 1) return {embed, callbacks: ReactionMenu.Callbacks(1, pages, embed)};
        return {embed};
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создает Embed сообщение + pages
     * @param message
     */
    private CreateEmbedMessage = (message: ClientMessage): EmbedConstructor => {
        return {
            title: "Help Menu",
            color: Colors.Yellow,
            thumbnail: {url: message.client.user.avatarURL()},
            timestamp: new Date()
        };
    };
}