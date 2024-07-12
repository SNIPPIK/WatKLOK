import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {API, Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("owner")
                .setDescription("Набор команд для разработчика")
                .setDescriptionLocale({
                    "en-US": "A set of commands for the developer"
                })
                .setDMPermission(false)
                .addSubCommands([
                    {
                        name: "platform",
                        description: "Действия с платформой!",
                        descriptionLocalizations: {
                            "en-US": "Actions with the platform!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "choice",
                                description: "Действия",
                                descriptionLocalizations: {
                                    "en-US": "Actions"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: [
                                    {
                                        name: "block - Заблокировать доступ",
                                        nameLocalizations: {
                                            "en-US": "block - Block access"
                                        },
                                        value: "block"
                                    },
                                    {
                                        name: "unblock - Разблокировать доступ",
                                        nameLocalizations: {
                                            "en-US": "unblock - Unlock access"
                                        },
                                        value: "unblock"
                                    },
                                    {
                                        name: "status - Статусы платформы",
                                        nameLocalizations: {
                                            "en-US": "status - Platform statuses"
                                        },
                                        value: "status"
                                    }
                                ]
                            },
                            {
                                name: "platform",
                                description: "Действия с платформой!",
                                descriptionLocalizations: {
                                    "en-US": "Actions with the platform!"
                                },
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
                    },
                    {
                        name: "avatar",
                        description: "Изменение аватара бота!",
                        descriptionLocalizations: {
                            "en-US": "Change avatar a bot"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "file",
                                description: "Смена аватара",
                                descriptionLocalizations: {
                                    "en-US": "Change avatar"
                                },
                                type: ApplicationCommandOptionType.Attachment,
                                required: true
                            }
                        ]
                    }
                ])
                .json,
            owner: true,
            execute: ({message, args, sub}) => {
                const client = message.client;

                switch (sub) {
                    case "platform": {
                        if (args[0] === "block") {
                            //Если платформа уже заблокирована
                            if (db.api.platforms.block.includes(args[1] as API.platform)) return {
                                content: locale._(message.locale,"platform.block.retry", [message.author]),
                                color: "Yellow"
                            };

                            db.api.platforms.block.push(args[1] as API.platform);
                            return  {
                                content: locale._(message.locale,"platform.block", [message.author]), color: "Green"
                            };
                        }
                        else if (args[0] === "unblock") {
                            //Если платформа не заблокирована
                            if (!db.api.platforms.block.includes(args[1] as API.platform)) return {
                                content: locale._(message.locale,"platform.unlock.retry", [message.author]), color: "Yellow"
                            };

                            const index = db.api.platforms.block.indexOf(args[1] as API.platform);
                            db.api.platforms.block.splice(index - 1, 1);
                            return  {
                                content: locale._(message.locale,"platform.unlock", [message.author]), color: "Green"
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
                        break;
                    }
                    case "avatar": {
                        const attachment = (message as Client.interact).options.getAttachment("file");
                        const embed = new MessageBuilder().setTime(20e3);

                        //Если попытка всунуть не изображение
                        if (!attachment.contentType.match(/image/)) return {
                            content: locale._(message.locale, "command.owner.avatar.null.image"),
                            color: "Yellow"
                        };

                        return new Promise((resolve) => {
                            //Устанавливаем аватар бота
                            client.user.setAvatar(attachment.url).then(() => {
                                return resolve(embed.addEmbeds([
                                    {
                                        author: {name: client.user.username, iconURL: client.user.avatarURL()},
                                        description: locale._(message.locale, "command.owner.avatar"),
                                        color: Colors.Green
                                    }
                                ]));
                            }).catch((err) => {
                                return resolve(embed.addEmbeds([
                                    {
                                        author: {name: client.user.username, iconURL: client.user.avatarURL()},
                                        description: locale._(message.locale, "command.owner.avatar.fail", [err]),
                                        color: Colors.DarkRed
                                    }
                                ]));
                            });
                        });
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