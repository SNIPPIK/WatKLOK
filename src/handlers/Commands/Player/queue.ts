import {ApplicationCommandOptionType, Colors} from "discord.js";
import {History} from "@lib/player/utils/History";
import {Constructor, Handler} from "@handler";
import {Logger} from "@env";
import {db} from "@lib/db";

class Group extends Constructor.Assign<Handler.Command>{
    public constructor() {
        super({
            name: "queue",
            description: "Управление треками!",
            options: [
                //Group
                {
                    name: "songs",
                    description: "Управление треками!",
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    options: [
                        {
                            name: "skip",
                            description: "Пропуск текущей музыки!",
                            type: ApplicationCommandOptionType.Subcommand,
                            options: [{
                                name: "value",
                                description: "Укажите какую музыку пропускаем!",
                                type: ApplicationCommandOptionType["String"]
                            }],
                        },
                        {
                            name: "remove",
                            description: "Эта команда удаляет из очереди музыку!",
                            type: ApplicationCommandOptionType.Subcommand,
                            options: [
                                {
                                    name: "value",
                                    description: "Номер трека который надо удалить из очереди",
                                    required: true,
                                    type: ApplicationCommandOptionType.String
                                }
                            ]
                        },
                        {
                            name: "history",
                            description: "Все прослушанные треки этого сервера!",
                            type: ApplicationCommandOptionType.Subcommand
                        },
                    ]
                },

                {
                    name: "repeat",
                    description: "Включение повтора и выключение повтора музыки!",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "type",
                            description: "Тип повтора, необходимо указать!",
                            type: ApplicationCommandOptionType["String"],
                            choices: [
                                {
                                    name: "song | Повтор текущего трека",
                                    value: "song"
                                },
                                {
                                    name: "songs | Повтор всех треков",
                                    value: "songs"
                                },
                                {
                                    name: "off | Выключение повтора",
                                    value: "off"
                                }
                            ]
                        }
                    ]
                },
                {
                    name: "list",
                    description: "Список треков!",
                    type: ApplicationCommandOptionType.Subcommand
                },
                {
                    name: "radio",
                    description: "Управление режимом 24/7",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "type",
                            description: "Что необходимо сделать с режимом 24/7!",
                            type: ApplicationCommandOptionType["String"],
                            choices: [
                                {
                                    name: "enable",
                                    value: "on",
                                },
                                {
                                    name: "disable",
                                    value: "off",
                                }
                            ]
                        }
                    ]
                }
            ],

            execute: ({message, args, sub}) => {
                const { author, member, guild } = message;
                const queue = db.audio.queue.get(guild.id);

                if (sub === "history") {
                    //Если история отключена
                    if (!History.enable) return { content: `${author} | История прослушиваний выключена!`, color: "Yellow" };

                    const file = History.getFile(message.guildId);

                    //Если нет файла
                    if (!file) return { content: `${author} | На этом сервере еще не включали музыку!`, color: "Yellow" };

                    const jsonFile = JSON.parse(file);

                    //Создаем странички
                    const pages = (jsonFile.tracks as any[]).ArraySort(10, (track) =>
                        `\`\`${track.platform.toUpperCase()}\`\` | \`\`${track.total}\`\` -> [${track.author.title}](${track.author.url}) - [${track.title}](${track.url})`, "\n"
                    );

                    //Создаем EMBED
                    const embed = {
                        title: `История прослушиваний`, color: Colors.Gold, description: pages[0], timestamp: new Date(),
                        footer: { text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL() },
                    }

                    return { embeds: [embed], pages, page: 1,
                        callback: (msg, pages, page) => {
                            const updateEmbed = { ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}` } };

                            return msg.edit({ embeds: [updateEmbed] });
                        }
                    };
                }

                //Если нет очереди
                if (!queue) return { content: `${author} | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author} | Необходимо подключиться к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если пользователю надо показать текущие треки
                if (sub === "list") {
                    if (queue.songs.length === 1) return { content: `${author} | Играет всего один трек.`, color: "Yellow" };

                    let num = 0;
                    const pages = queue.songs.slice(1).ArraySort(5, (track) => { num++;
                        return `\`${num}\` - \`\`[${track.duration.full}]\`\` [${track.requester.username}](${track.author.url}) - [${track.title}](${track.url})`;
                    }, "\n");
                    const embed = {
                        title: `Queue - ${message.guild.name}`,
                        color: Colors.Green,
                        fields: [
                            {
                                name: `**Играет:**`,
                                value: `\`\`\`${queue.songs.song.title}\`\`\``
                            }
                        ],
                        footer: {
                            text: `${queue.songs.song.requester.username} | Лист 1 из ${pages.length} | Songs: ${queue.songs.length}/${queue.songs.time()}`,
                            iconURL: queue.songs.song.requester.avatar
                        }
                    };

                    if (pages.length > 0) embed.fields.push({ name: "**Следующее:**", value: pages[0] });

                    return {
                        embeds: [embed], pages, page: 1,
                        callback: (msg, pages: string[], page: number) => {
                            embed.fields[1] = { name: "**Следующее:**", value: pages[page - 1] };
                            const updateEmbed = { ...embed, footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}` } };

                            return msg.edit({ embeds: [updateEmbed] });
                        }
                    };
                }

                //Если пользователь меняет тип повтора
                else if (sub === "repeat") {
                    const argument = args?.pop()?.toLowerCase();

                    switch (argument) {
                        case "song": {
                            queue.repeat = "song";
                            return { content: `🔂 | Повтор  | ${queue.songs[0].title}`, codeBlock: "css"};
                        }
                        case "songs": {
                            queue.repeat = "songs";
                            return { content: `🔁 | Повтор всей музыки`, codeBlock: "css"};
                        }
                        case "off": {
                            queue.repeat = "off";
                            return { content: `❌ | Повтор выключен`, codeBlock: "css"};
                        }
                    }

                    return;
                }

                //Управление режимом 24/7
                else if (sub === "radio") {
                    //@ts-ignore
                    if (!member.permissions.has("MANAGE_SERVER") && env.get("player.radio.admin")) return { content: `${author} | Эта команда доступна только для права \`MANAGE_SERVER\`!`, color: "Yellow" };

                    if (args[0] === "on") {
                        if (queue.radio) return { content: `${author} | Уже включен режим радио!`, color: "Yellow" };

                        queue.radio = true;
                        return { content: `${author} | Включен режим радио!`, color: "Green" };
                    } else {
                        if (!queue.radio) return { content: `${author} | Уже выключен режим радио!`, color: "Yellow" };

                        queue.radio = false;
                        return { content: `${author} | Выключен режим радио!`, color: "Green" };
                    }
                }

                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                //Если аргумент не является числом
                if (isNaN(arg)) return { content: `${author} | Аргумент не является числом` };

                switch (sub) {
                    case "skip": {
                        let {player, songs} = queue, {title} = songs[arg - 1];

                        try {
                            //Если музыку нельзя пропустить из-за плеера
                            if (!player.playing) return { content: `${author} | Музыка еще не играет!`, color: "Yellow" };

                            //Если пользователь укажет больше чем есть в очереди
                            else if (arg > songs.length && arg < queue.songs.length) return { content: `${author} | В очереди ${songs.length}!`, color: "Yellow" };

                            else if (arg > 1) {
                                if (queue.repeat === "songs") for (let i = 0; i < arg - 2; i++) songs.push(songs.shift());
                                else queue.songs.splice(arg - 2, 1);
                            }

                            player.stop();
                            return arg > 1 ? { content: `⏭️ | Skip to song [${arg}] | ${title}`, codeBlock: "css", color: "Green" } : { content: `⏭️ | Skip song | ${title}`, codeBlock: "css", color: "Green" }
                        } catch (err) {
                            Logger.log("ERROR", err);
                            return { content: `${author} | Ошибка... попробуй еще раз!!!`, color: "DarkRed" };
                        }
                    }
                    case "remove": {
                        //Если аргумент больше кол-ва треков
                        if (arg > queue.songs.length && arg < queue.songs.length) return { content: `${author} | Я не могу убрать музыку, поскольку всего ${queue.songs.length}!`, color: "Yellow" };

                        //Если музыку нельзя пропустить из-за плеера
                        else if (!queue.player.playing) return { content: `${author} | Музыка еще не играет!`, color: "Yellow" };

                        let {title} = queue.songs[arg - 1];

                        if (arg === 1) {
                            if (queue.repeat !== "off") {
                                queue.songs.splice(0, 1); //Удаляем первый трек
                                queue.player.stop();
                            } else queue.player.stop();
                        } else queue.songs.splice(arg - 1, 1); //Удаляем трек указанный пользователем

                        //Сообщаем какой трек был убран
                        return { content: `⏭️ | Remove song | ${title}`, codeBlock: "css", color: "Green" };
                    }
                }
            }
        });
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Group});