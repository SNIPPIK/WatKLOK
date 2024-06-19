import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("filter")
                .setDescription("Управление фильтрами")
                .addSubCommands([
                    {
                        name: "add",
                        description: "Добавление фильтров!",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                type: ApplicationCommandOptionType["String"],
                                choices: db.audio.filters.length < 25 ? db.audio.filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        value: filter.name
                                    }
                                }) : []
                            },
                            {
                                name: "argument",
                                description: "Аргумент для фильтра, если он необходим!",
                                type: ApplicationCommandOptionType["String"]
                            }
                        ]
                    },
                    {
                        name: "remove",
                        description: "Удаление фильтров!",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                type: ApplicationCommandOptionType["String"],
                                choices: db.audio.filters.length < 25 ? db.audio.filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        value: filter.name
                                    }
                                }) : []
                            }
                        ]
                    },
                    {
                        name: "off",
                        description: "Отключение фильтров!",
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "list",
                        description: "Списки",
                        type: ApplicationCommandOptionType.SubcommandGroup,
                        options: [
                            {
                                name: "current",
                                description: "Текущие фильтры!",
                                type: ApplicationCommandOptionType.Subcommand
                            },
                            {
                                name: "total",
                                description: "Доступные фильтры!",
                                type: ApplicationCommandOptionType.Subcommand
                            }
                        ]
                    }
                ])
                .json,
            execute: ({message, args, sub}) => {
                const { author, member, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author} | Музыка сейчас не играет`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return {
                    content: `${author} | Необходимо подключиться к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если статус плеера не позволяет пропустить поток
                else if (!queue.player.playing) return {
                    content: `${author} | На данном этапе невозможно пропустить поток!`,
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return {
                    content: `${author} | Фильтры не могут работать совместно с Live треками!`,
                    color: "Yellow"
                };

                const seek: number = queue.player.stream?.duration ?? 0;
                const name = args[args?.length - 2 ?? args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;
                const Filter = db.audio.filters.find((item) => item.name === name);
                const index = queue.player.filters.indexOf(Filter);

                switch (sub) {
                    case "current":
                    case "total": {
                        let array = db.audio.filters;
                        if (sub === "current") {
                            if (queue?.player.filters.length === 0) return { content: `${author.username}, включенных аудио фильтров нет!`, codeBlock: "css" };
                            array = queue?.player?.filters;
                        }

                        //Преобразуем все фильтры в string
                        const pages = array.ArraySort(5, (filter, index) => {
                            return `┌Номер в списке - [${index + 1}]
                    ├ **Название:** ${filter.name ? `(${filter.name})` : `Нет`}
                    ├ **Аргументы:** ${filter.args ? `(${filter.args})` : `Нет`}
                    ├ **Модификатор скорости:** ${filter.speed ? `${filter.speed}` : `Нет`}
                    └ **Описание:** ${filter.description ? `(${filter.description})` : `Нет`}`
                        });

                        return new MessageBuilder().addEmbeds([
                            {
                                title: "Все фильтры",
                                description: pages[0],
                                color: Colors.Yellow,
                                thumbnail: { url: message.client.user.avatarURL() },
                                timestamp: new Date(),
                                footer: {
                                    text: `${message.author.username} | Лист 1 из ${pages.length}`, iconURL: message.author.displayAvatarURL()
                                }
                            }
                        ]).setPages(pages).setTime(60e3).setCallback((msg, pages, page, embed) => {
                            return msg.edit({
                                embeds: [{ ...embed[0], description: pages[page - 1], footer: { ...embed[0].footer, text: `${message.author.username} | Лист ${page} из ${pages.length}`} }]
                            });
                        })
                    }
                    case "off": {
                        if (queue?.player.filters.length === 0) return { content: `${author.username}, включенных аудио фильтров нет!` };

                        queue.player.filters.splice(0, queue.player.filters.length); //Удаляем фильтр
                        queue.player.play(queue.songs.song, seek);
                        return;
                    }

                    case "add": {
                        if (index !== -1) return { content: `Filter: ${name} уже включен!`, color: "Yellow" };

                        //Делаем проверку на совместимость
                        for (let i = 0; i < queue.player.filters.length; i++) {
                            const filter = queue.player.filters[i];

                            if (Filter.unsupported.includes(filter.name)) return { content: `${author.username}, найден не совместимый фильтр! ${filter.name} нельзя использовать вместе с ${Filter.name}` };
                        }

                        if (Filter.args) {
                            const isOkArgs = arg && arg >= Filter.args[0] && arg <= Filter.args[1];

                            //Если аргументы не подходят
                            if (!isOkArgs) return {
                                content: `Filter: ${name} не изменен из-за несоответствия аргументов!\nMin: ${Filter.args[0]} | Max: ${Filter.args[1]}`,
                                color: "Yellow",
                            };
                        }

                        //Если надо добавить аргумент
                        if (arg && Filter.args) Filter.user_arg = arg;

                        queue.player.filters.push(Filter);
                        queue.player.play(queue.songs.song, seek);

                        return {content: `**Filter:**\n${Filter.user_arg ? `${name}:${args}` : name} включен!`, color: "Green", replied: false};
                    }
                    case "remove": {
                        if (index === -1) return { content: `Filter: ${name} не включен!`, color: "Yellow" };

                        queue.player.filters.splice(index, 1); //Удаляем фильтр
                        queue.player.play(queue.songs.song, seek);
                        return {content: `Filter: ${name} отключен!`, color: "Green", replied: false};
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