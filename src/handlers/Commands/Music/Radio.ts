import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @class Command_Radio
 * @command radio
 * @description Управление радио
 */
class Command_Radio extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("radio")
                .setDescription("Управление режимом 24/7")
                .setDescriptionLocale({
                    "en-US": "24/7 mode management"
                })
                .addSubCommands([
                    {
                        name: "type",
                        description: "Что необходимо сделать с режимом 24/7!",
                        descriptionLocalizations: {
                            "en-US": "What needs to be done with 24/7 mode!"
                        },
                        type: ApplicationCommandOptionType["String"],
                        choices: [
                            {
                                name: "вкл",
                                nameLocalizations: {
                                    "en-US": "on"
                                },
                                value: "on",
                            },
                            {
                                name: "выкл",
                                nameLocalizations: {
                                    "en-US": "off"
                                },
                                value: "off",
                            }
                        ]
                    }
                ])
                .json,
            intents: ["voice", "queue", "anotherVoice"],
            execute: ({message, args}) => {
                const { author, member, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                //@ts-ignore
                if (!member.permissions.has("MANAGE_SERVER") && env.get("player.radio.admin")) return {
                    content: locale._(message.locale,"player.radio.enable.rule", [author, "MANAGE_SERVER"]),
                    color: "Yellow"
                };

                if (args[0] === "on") {
                    if (queue.radio) return {
                        content: locale._(message.locale,"player.radio.enable.retry", [author]),
                        color: "Yellow"
                    };

                    queue.radio = true;
                    return {
                        content: locale._(message.locale,"player.radio.enable", [author]),
                        color: "Green"
                    };
                } else {
                    if (!queue.radio) return {
                        content: locale._(message.locale,"player.radio.disable.retry", [author]),
                        color: "Yellow"
                    };

                    queue.radio = false;
                    return {
                        content: locale._(message.locale,"player.radio.disable", [author]),
                        color: "Green"
                    };
                }
            }
        });
    };
}


/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Radio});