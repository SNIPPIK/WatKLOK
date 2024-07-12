import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class Command_Help
 * @command help
 * @description Команда для помощи!
 * @license https://github.com/SNIPPIK/WatKLOK/blob/nightly/LICENSE.md
 */
class Command_Help extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            afterLoad: true,
            data: new SlashBuilder()
                .setName("help")
                .setDescription("Нужна помощь с командами?")
                .setDescriptionLocale({
                    "en-US": "Need a help commands?"
                })
                .addSubCommands([
                    {
                        name: "select",
                        description: "Выбор команды!",
                        descriptionLocalizations: {
                            "en-US": "Select command!"
                        },
                        type: ApplicationCommandOptionType.String,

                        //@ts-ignore | afterLoad - команды будут загружены позже
                        choices: null
                    }
                ])
                .json,
            execute: ({message, args}) => {
                const command = db.commands.get(args[0]);
                const { author } = message;

                //Если такой команды нет
                if (!command) return {
                    content: locale._(message.locale, "command.help.null"),
                    color: "DarkRed"
                }

                const commandData = command.data;
                const usage = commandData.options?.pop()?.name || "";
                const description = commandData.description_localizations[message.locale] || commandData.description;

                return new MessageBuilder().addEmbeds([
                    {
                        title: locale._(message.locale, "command.help.title"),
                        description: locale._(message.locale, "command.help", [
                            commandData.name, commandData.name, usage, command.owner ? locale._(message.locale, "yes"): locale._(message.locale, "undefined"), description
                        ]),
                        thumbnail: { url: message.client.user.avatarURL() },
                        timestamp: new Date(),
                        footer: { text: `${author.username} | ${db.commands.length}`, iconURL: author.avatarURL() }
                    }
                ]);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Help});