import {ApplicationCommandOptionType} from "discord.js";
import {Command, Constructor} from "@handler";
import {db} from "@Client/db";
import {API} from "@handler";

/**
 * @class Command_Platform
 * @description Стандартная команда platform
 * @param choice - Действие с платформой
 * @param platform - Название платформы
 */
class Command_Platform extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "platform",
            description: "Действия с платформой!",
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
                    choices: (db.platforms.supported.length < 25 ? db.platforms.supported : db.platforms.supported.splice(0, 20)).map((platform) => {
                        return {
                            name: `${platform.name}`,
                            value: platform.name
                        }
                    }),
                }
            ],
            owner: true,

            execute: (message, args) => {
                if (args[0] === "block") {
                    //Если платформа уже заблокирована
                    if (db.platforms.block.includes(args[1] as API.platform)) return {
                        content: `${message.author}, Платформа уже заблокирована!`, color: "Yellow"
                    };

                    db.platforms.block.push(args[1] as API.platform);
                    return  {
                        content: `${message.author}, Платформа заблокирована!`, color: "Green"
                    };
                }

                else if (args[0] === "unblock") {
                    //Если платформа не заблокирована
                    if (!db.platforms.block.includes(args[1] as API.platform)) return {
                        content: `${message.author}, Платформа не заблокирована!`, color: "Yellow"
                    };

                    const index = db.platforms.block.indexOf(args[1] as API.platform);
                    db.platforms.block.splice(index - 1, 1);
                    return  {
                        content: `${message.author}, Платформа разблокирована!`, color: "Green"
                    };
                }

                else if (args[0] === "status") {
                    const platform = db.platforms.supported.find((platform) => platform.name === args[0]);
                    const fields = [
                        `isAuth:  ${platform.auth}`,
                        `isAudio: ${platform.audio}`,
                    ];

                    return {
                        embeds: [{
                            timestamp: new Date(),
                            color: platform.color,
                            author: {name: platform.name.toLowerCase(), url: `https://${platform.url}`},
                            footer: {text: `${message.author.username}`, iconURL: message.author.displayAvatarURL()},
                            description: fields.join("\n")
                        }]
                    };
                }
            }
        });
    };
}

export default Object.values({Command_Platform});