import {ApplicationCommandOptionType} from "discord.js";
import {API} from "@handler/APIs";
import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
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
                    choices: (db.music.platforms.supported.length < 25 ? db.music.platforms.supported : db.music.platforms.supported.splice(0, 20)).map((platform) => {
                        return {
                            name: `${platform.name}`,
                            value: platform.name
                        }
                    }),
                }
            ],
            isOwner: true,

            execute: (message, args) => {
                if (args[0] === "block") {
                    //Если платформа уже заблокирована
                    if (db.music.platforms.block.includes(args[1] as API.platform)) return {
                        content: `${message.author}, Платформа уже заблокирована!`, color: "Yellow"
                    };

                    db.music.platforms.block.push(args[1] as API.platform);
                    return  {
                        content: `${message.author}, Платформа заблокирована!`, color: "Green"
                    };
                }

                else if (args[0] === "unblock") {
                    //Если платформа не заблокирована
                    if (!db.music.platforms.block.includes(args[1] as API.platform)) return {
                        content: `${message.author}, Платформа не заблокирована!`, color: "Yellow"
                    };

                    const index = db.music.platforms.block.indexOf(args[1] as API.platform);
                    db.music.platforms.block.splice(index - 1, 1);
                    return  {
                        content: `${message.author}, Платформа разблокирована!`, color: "Green"
                    };
                }

                else if (args[0] === "status") {
                    const platform = db.music.platforms.supported.find((platform) => platform.name === args[0]);
                    const fields = [
                        `isAuth:  ${platform.auth}`,
                        `isAudio: ${platform.audio}`,
                        `Prefix:  ${platform.prefix}`
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