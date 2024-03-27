import {ApplicationCommandOptionType, Colors, EmbedData, TextChannel} from "discord.js";
import {API, Constructor, Handler} from "@handler";
import {env, Logger} from "@env";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            name: "owner",
            description: "Набор команд для разработчика",
            options: [
                {
                    name: "eval",
                    description: "Выполнение JS кода!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "query",
                            description: "Нужен JavaScript код!",
                            required: true,
                            type: ApplicationCommandOptionType["String"]
                        }
                    ]
                },
                {
                    name: "post",
                    description: "Опубликую новость за вас! В специальный канал!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "description",
                            description: "Что будет указано в посте?",
                            required: true,
                            type: ApplicationCommandOptionType["String"],
                        },
                    ]
                },
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
                            choices: (db.platforms.supported.length < 25 ? db.platforms.supported : db.platforms.supported.splice(0, 20)).map((platform) => {
                                return {
                                    name: `[${platform.requests.length}] ${platform.url} | ${platform.name}`,
                                    value: platform.name
                                }
                            }),
                        }
                    ]
                }
            ],
            owner: true,
            execute: ({message, args, sub}) => {
                switch (sub) {
                    case "eval": {
                        const userCode = args.join(" ");
                        const TimeStart = new Date().getMilliseconds();
                        const { client } = message;

                        try {
                            const runEval = eval(userCode);
                            return {
                                embeds: [this._getEmbed(TimeStart, new Date().getMilliseconds(), userCode, runEval, Colors.Green)]
                            }
                        } catch (err) {
                            return {
                                embeds: [this._getEmbed(TimeStart, new Date().getMilliseconds(), userCode, err, Colors.Green)]
                            }
                        }
                    }
                    case "post": {
                        const {author, client} = message;
                        const channel = client.channels.cache.get(env.get("owner.news")) as TextChannel;

                        return new Promise((resolve) => {
                            if (channel) {
                                channel.send({ //@ts-ignore
                                    embeds: [{
                                        color: Colors.Orange,
                                        timestamp: new Date() as any,
                                        author: {name: `${client.user.username} - публикует новость`, iconURL: client.user.avatarURL()},

                                        description: args.join(" "),

                                        footer: {
                                            text: `Автор: ${author.username}`, iconURL: author.avatarURL()
                                        }
                                    }] as EmbedData[]
                                }).catch((err) => {
                                    Logger.log("ERROR", err);

                                    return resolve({content: `${author} | Не удалось отправить сообщение!`, color: "Yellow"})
                                });

                                return resolve({content: `${author} | Сообщение отправлено!`, color: "Green"});
                            }

                            return resolve({content: `${author} | Канал не найден!`, color: "Yellow"});
                        });
                    }
                    case "platform": {
                        if (args[0] === "block") {
                            //Если платформа уже заблокирована
                            if (db.platforms.block.includes(args[1] as API.platform)) return {
                                content: `${message.author} | Платформа уже заблокирована!`, color: "Yellow"
                            };

                            db.platforms.block.push(args[1] as API.platform);
                            return  {
                                content: `${message.author} | Платформа заблокирована!`, color: "Green"
                            };
                        }
                        else if (args[0] === "unblock") {
                            //Если платформа не заблокирована
                            if (!db.platforms.block.includes(args[1] as API.platform)) return {
                                content: `${message.author} | Платформа не заблокирована!`, color: "Yellow"
                            };

                            const index = db.platforms.block.indexOf(args[1] as API.platform);
                            db.platforms.block.splice(index - 1, 1);
                            return  {
                                content: `${message.author} | Платформа разблокирована!`, color: "Green"
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
                }

            }
        });
    };

    /**
     * @description Получаем EMBED
     * @param start {number} Время начала выполнения
     * @param end {number} Время конца выполнения
     * @param userCode {string} Код пользователя
     * @param Eval {string} Что было получено в ходе выполнения кода
     * @param color {number} Цвет EMBED
     */
    private _getEmbed = (start: number, end: number, userCode: string, Eval: string, color: number) => {
        return {
            color, footer: { text: `Time: ${end - start} ms` }, fields:
                [
                    { name: "Input Code:", value: `\`\`\`js\n${userCode}\n\`\`\``, inline: false },
                    { name: "Output Code:", value: `\`\`\`js\n${Eval}\`\`\``, inline: false }
                ]
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});