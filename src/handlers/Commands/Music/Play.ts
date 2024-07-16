import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Client} from "@lib/discord";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class Command_Play
 * @command play
 * @description Включение музыки
 */
class Command_Play extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("play")
                .setDescription("Включение музыки!")
                .setDescriptionLocale({
                    "en-US": "Playing music!"
                })
                .addSubCommands([
                    {
                        name: "api",
                        description: "Включение музыки по ссылке или названию!",
                        descriptionLocalizations: {
                            "en-US": "Turn on music by link or title!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "select",
                                description: "К какой платформе относится запрос?",
                                descriptionLocalizations: {
                                    "en-US": "Which platform does the request belong to?"
                                },
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
                                descriptionLocalizations: {
                                    "en-US": "You must specify the link or the name of the track!"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"]
                            }
                        ],
                    },
                    {
                        name: "file",
                        description: "Включение музыки с использованием файла!",
                        descriptionLocalizations: {
                            "en-US": "Turning on music using a file!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "input",
                                description: "Необходимо прикрепить файл!",
                                descriptionLocalizations: {
                                    "en-US": "You need to attach a file!"
                                },
                                type: ApplicationCommandOptionType["Attachment"],
                                required: true
                            }
                        ]
                    }
                ])
                .json,
            intents: ["voice", "anotherVoice"],
            execute: ({message, args, sub}) => {
                const {author, member, guild} = message;
                const VoiceChannel = member?.voice?.channel;
                const queue = db.audio.queue.get(guild.id);

                //Если пользователь прикрепил файл
                if (sub === "file") {
                    const attachment = (message as Client.interact).options.getAttachment("input");

                    //Если пользователь подсунул фальшивку
                    if (!attachment.contentType.match("audio")) return {
                        content: locale._(message.locale,"command.play.attachment.audio.need", [author]),
                        color: "Yellow"
                    };

                    db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, ["DISCORD", attachment]);
                    return;
                }

                //Если пользователя пытается включить трек
                db.audio.queue.events.emit("collection/api", message as any, VoiceChannel, args);
                return;
            }
        });
    };
}

/**
 * @class Command_Replay
 * @command remove
 * @description Пропуск трека по номеру
 *
 * @param value - Номер пропускаемого трека
 */
class Command_Replay extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("replay")
                .setDescription("Повторить текущий трек?")
                .setDescriptionLocale({
                    "en-US": "Repeat current track?"
                }).json,
            intents: ["voice", "queue", "anotherVoice"],
            execute: ({message}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const { title } = queue.songs.song;

                queue.player.play(queue.songs.song);
                //Сообщаем о том что музыка начата с начала
                return { content: locale._(message.locale, "command.control.replay", [title]), color: "Green", codeBlock: "css" };
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Play, Command_Replay});