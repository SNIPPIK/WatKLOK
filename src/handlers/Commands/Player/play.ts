import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            name: "player",
            description: "Взаимодействия с плеером",
            permissions: ["Speak", "Connect"],
            options: [
                {
                    name: "play",
                    description: "Включение музыки по ссылке или названию!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "select",
                            description: "К какой платформе относится запрос?",
                            type: ApplicationCommandOptionType["String"],
                            required: true,
                            choices: db.api.allow.map((platform) => {
                                return {
                                    name: `[${platform.requests.length}] ${platform.url} | ${platform.name}`,
                                    value: platform.name
                                }
                            })
                        },
                        {
                            name: "request",
                            description: "Необходимо указать ссылку или название трека!",
                            required: true,
                            type: ApplicationCommandOptionType["String"]
                        }
                    ],
                },
                {
                    name: "file",
                    description: "Включение музыки с использованием файла!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "input",
                            description: "Необходимо прикрепить файл!",
                            type: ApplicationCommandOptionType["Attachment"],
                            required: true
                        }
                    ]
                }
            ],

            execute: ({message, args, sub}) => {
                const {author, member, guild} = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: `${author} | Необходимо подключиться к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если пользователь прикрепил файл
                if (sub === "file") {
                    const attachment = (message as Client.interact).options.getAttachment("input");

                    //Если пользователь подсунул фальшивку
                    if (!attachment.contentType.match("audio")) return {
                        content: `${author} | В этом файле нет звуковой дорожки!`,
                        color: "Yellow"
                    };

                    db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, ["DISCORD", attachment]);
                    return;
                }

                //Если пользователя пытается включить трек
                db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, args);
                return;
            }
        })
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});