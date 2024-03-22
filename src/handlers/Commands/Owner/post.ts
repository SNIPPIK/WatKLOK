import {ApplicationCommandOptionType, Colors, EmbedData, TextChannel} from "discord.js";
import {Constructor, handler} from "@handler";
import {Logger} from "@lib/discord";
import {env} from "@env";

/**
 * @class Command_Platform
 * @description Стандартная команда post
 * @param description - Что будет указано в посте
 */
class Command_Post extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "post",
            description: "Опубликую новость за вас! В специальный канал!",
            options: [
                {
                    name: "description",
                    description: "Что будет указано в посте?",
                    required: true,
                    type: ApplicationCommandOptionType["String"],
                },
            ],
            owner: true,

            execute: (message, args) => {
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

                            return resolve({content: `${author}, не удалось отправить сообщение!`, color: "Green"})
                        });

                        return resolve({content: `${author}, сообщение отправлено!`, color: "Green"});
                    }

                    return resolve({content: `${author}, канал не найден!`, color: "Green"});
                });
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Post});