import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class Command_songs
 * @command songs
 * @description Просмотр текущих треков
 */
class Command_songs extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("songs")
                .setDescription("Просмотр треков")
                .setDescriptionLocale({
                    "en-US": "Viewing tracks"
                })
                .addSubCommands([
                    {
                        name: "history",
                        description: "Все прослушанные треки этого сервера!",
                        descriptionLocalizations: {
                            "en-US": "All the tracks you listened to on this server!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "current",
                        description: "Список треков!",
                        descriptionLocalizations: {
                            "en-US": "Track list!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                ])
                .json,
            intents: ["voice", "queue", "anotherVoice"],
            execute: ({message, sub}) => {
                const { author, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                // История прослушивания
                if (sub === "history") {
                    //Если история отключена
                    if (!db.cache.history) return {
                        content: locale._(message.locale,"player.history.disable", [author]),
                        color: "Yellow"
                    };

                    const file = db.cache.history.getFile(message.guildId);

                    //Если нет файла
                    if (!file) return {
                        content: locale._(message.locale,"player.history.null", [author]),
                        color: "Yellow"
                    };

                    const jsonFile = JSON.parse(file);

                    //Создаем странички
                    const pages = (jsonFile.tracks as any[]).ArraySort(10, (track) =>
                        `\`\`${track.platform.toUpperCase()}\`\` | \`\`${track.total}\`\` -> [${track.author.title}](${track.author.url}) - [${track.title}](${track.url})`, "\n"
                    );

                    //Создаем EMBED
                    return new MessageBuilder().addEmbeds([
                        {
                            title: locale._(message.locale,"player.history"), color: Colors.Gold, description: pages[0], timestamp: new Date(),
                            footer: { text: locale._(message.locale,"global.listOf", [author.username, 1, pages.length]), iconURL: author.avatarURL() },
                        }
                    ]).setPages(pages).setTime(60e3).setCallback((msg, pages, page, embed) => {
                        return msg.edit({
                            embeds: [
                                {
                                    ...embed[0],
                                    description: pages[page - 1],
                                    footer: {
                                        ...embed[0].footer,
                                        text: locale._(message.locale,"global.listOf", [msg.author.username, page, pages.length])
                                    }
                                }
                            ]
                        });
                    })
                }

                //Если пользователю надо показать текущие треки
                if (sub === "current") {
                    if (queue.songs.length === 1) return {
                        content: locale._(message.locale,"InteractionCreate.button.arg", [author]),
                        color: "Yellow"
                    };

                    let num = 0;
                    const pages = queue.songs.slice(1).ArraySort(5, (track) => { num++;
                        return `\`${num}\` - \`\`[${track.duration.full}]\`\` [${track.requester.username}](${track.author.url}) - [${track.title}](${track.url})`;
                    }, "\n");

                    return new MessageBuilder().addEmbeds([
                        {
                            title: locale._(message.locale,"queue", [message.guild.name]),
                            color: Colors.Green,
                            fields: [
                                {
                                    name: locale._(message.locale,"player.message.playing.current"),
                                    value: `\`\`\`${queue.songs.song.title}\`\`\``
                                },
                                pages.length > 0 ? { name: locale._(message.locale,"player.message.playing.next"), value: pages[0] } : null
                            ],
                            footer: {
                                text: locale._(message.locale,"global.listOf.queue", [queue.songs.song.requester.username, 1, pages.length, queue.songs.size, queue.songs.time()]),
                                iconURL: queue.songs.song.requester.avatar
                            }
                        }
                    ]).setPages(pages).setTime(60e3).setCallback((msg, pages: string[], page: number, embed) => {
                        return msg.edit({
                            embeds: [
                                {
                                    ...embed[0],
                                    fields: [
                                        embed[0].fields[0],
                                        { name: locale._(message.locale,"player.message.playing.next"), value: pages[page - 1] }
                                    ],
                                    footer: {
                                        ...embed[0].footer,
                                        text: locale._(message.locale,"global.listOf.queue", [message.author.username, page, pages.length, queue.songs.size, queue.songs.time()])
                                    }
                                }
                            ]
                        });
                    });
                }
            }
        });
    };
}


/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_songs});