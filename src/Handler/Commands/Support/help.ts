import {ApplicationCommandOptionType, Colors} from "discord.js";
import {ArraySort, Command} from "@handler";

import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "help",
            description: "Можешь глянуть все мои команды!",

            usage: "all | command name",
            options: [
                {
                    name: "command",
                    description: "Необходимо указать имя команды или all!",
                    required: true,
                    type: ApplicationCommandOptionType["String"]
                }
            ],

            execute: (message, args) => {
                const { author } = message;
                const Arg = args[args.length - 1]?.toLowerCase();

                const Commands: Command[] = db.commands.filter((command: Command) => {
                    if (!Arg || Arg === "all") return !command.isOwner;
                    else return command.name === Arg;
                }).toJSON();

                //Если пользователь хочет получить данные о не существующей команде
                if (!Commands?.length) return { content: `${author}, у меня нет такой команды!`, color: "Yellow" };

                //Создаем странички
                const pages = ArraySort<Command>(5, Commands, (command) =>
                    `┌Команда [**${command.name}**]
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

                if (pages.length === 1) return { embeds: [embed], time: 20e3 };

                return {
                    embeds: [embed], pages, page: 1,
                    callback: (msg, pages, page) => {
                        const updateEmbed = { ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}` } };
                        return msg.edit({ embeds: [updateEmbed] });
                    }
                }
            }
        });
    };
}