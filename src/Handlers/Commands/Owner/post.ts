import {ApplicationCommandOptionType, Colors, EmbedData, TextChannel} from "discord.js";
import {Command, Assign} from "@handler";
import {Logger} from "@Client";
import {env} from "@env";

export default class extends Assign<Command> {
    public constructor() {
        super({
            name: "post",
            description: "Опубликую новость за вас! В спец канал!",
            options: [
                {
                    name: "description",
                    description: "Что указать в посте!",
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