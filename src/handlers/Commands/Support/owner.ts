import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {API, Constructor, Handler} from "@handler";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("owner")
                .setDescription("Набор команд для разработчика")
                .setDMPermission(false)
                .addSubCommands([
                    {
                        name: "platform",
                        description: "Действия с платформой!",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "choice",
                                description: "Действия",
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: [
                                    {
                                        name: "block - Заблокировать доступ",
                                        value: "block"
                                    },
                                    {
                                        name: "unblock - Разблокировать доступ",
                                        value: "unblock"
                                    },
                                    {
                                        name: "status - Статусы платформы",
                                        value: "status"
                                    }
                                ]
                            },
                            {
                                name: "platform",
                                description: "Укажи платформу",
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: (db.api.platforms.supported.length < 25 ? db.api.platforms.supported : db.api.platforms.supported.splice(0, 20)).map((platform) => {
                                    return {
                                        name: `[${platform.requests.length}] ${platform.url} | ${platform.name}`,
                                        value: platform.name
                                    }
                                }),
                            }
                        ]
                    }
                ])
                .json,
            owner: true,
            execute: ({message, args, sub}) => {
                switch (sub) {
                    case "platform": {
                        if (args[0] === "block") {
                            //Если платформа уже заблокирована
                            if (db.api.platforms.block.includes(args[1] as API.platform)) return {
                                content: `${message.author} | Платформа уже заблокирована!`, color: "Yellow"
                            };

                            db.api.platforms.block.push(args[1] as API.platform);
                            return  {
                                content: `${message.author} | Платформа заблокирована!`, color: "Green"
                            };
                        }
                        else if (args[0] === "unblock") {
                            //Если платформа не заблокирована
                            if (!db.api.platforms.block.includes(args[1] as API.platform)) return {
                                content: `${message.author} | Платформа не заблокирована!`, color: "Yellow"
                            };

                            const index = db.api.platforms.block.indexOf(args[1] as API.platform);
                            db.api.platforms.block.splice(index - 1, 1);
                            return  {
                                content: `${message.author} | Платформа разблокирована!`, color: "Green"
                            };
                        }
                        else if (args[0] === "status") {
                            const platform = db.api.platforms.supported.find((platform) => platform.name === args[1]);
                            const fields = [
                                `isAuth:  ${platform.auth}`,
                                `isAudio: ${platform.audio}`,
                            ];

                            return new MessageBuilder().addEmbeds([
                                {
                                    timestamp: new Date(),
                                    color: platform.color,
                                    author: {name: platform.name.toLowerCase(), url: `https://${platform.url}`},
                                    footer: {text: `${message.author.username}`, iconURL: message.author.displayAvatarURL()},
                                    description: fields.join("\n")
                                }
                            ]);
                        }
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});