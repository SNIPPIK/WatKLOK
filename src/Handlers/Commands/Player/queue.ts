import {History} from "@watklok/player/utils/History";
import {Duration, ArraySort} from "@watklok/player";
import {Command, Constructor} from "@handler";
import {Colors, EmbedData} from "discord.js";
import {db} from "@Client/db";

/**
 * @class Command_Queue
 * @command queue
 * @description Список добавленных треков
 */
class Command_Queue extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "queue",
            description: "Список добавленных треков",
            execute: (message) => {
                const { author, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };
                else if (queue.songs.length === 1) return { content: `${author}, ⚠ | Играет всего один трек.`, color: "Yellow" };

                let num = 0;
                const pages = ArraySort(5, queue.songs.slice(1), (track) => { num++;
                    return `\`${num}\` - \`\`[${track.duration.full}]\`\` [${track.requester.username}](${track.author.url}) - [${track.title}](${track.url})`;
                }, "\n");
                const embed: EmbedData = {
                    title: `Queue - ${message.guild.name}`,
                    color: Colors.Green,
                    fields: [
                        {
                            name: `**Играет:**`,
                            value: `\`\`\`${queue.songs.song.title}\`\`\``
                        }
                    ],
                    footer: {
                        text: `${queue.songs.song.requester.username} | Лист 1 из ${pages.length} | Songs: ${queue.songs.length}/${Duration.getTimeArray(queue.songs)}`,
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
        });
    };
}

/**
 * @class Command_Channel
 * @command channel
 * @description Смена текстового канала для музыкальной очереди этого сервера
 */
class Command_Channel extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "channel",
            description: "Смена текстового канала для музыкальной очереди этого сервера!",

            execute: (message) => {
                const { author, member, guild } = message;
                const voiceChannel = member?.voice?.channel;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!voiceChannel) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текстовые каналы совпадают
                else if (queue.message.channelId === message.channelId) return {content: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                //Если возможно удалить текстовое сообщение, то удаляем
                else if (queue.message.deletable) queue.message.delete().catch((): any => undefined);

                queue.message = message as any;
                db.queue.events.emit("message/playing", queue);

                return {content: `${author}, смена текстового канал для ${guild} произведена`, color: "Green"}
            }
        });
    };
}

/**
 * @class Command_History
 * @command history
 * @description История прослушиваний этого сервера
 */
class Command_History extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "history",
            description: "История прослушиваний этого сервера!",

            execute: (message) => {
                const { author } = message;

                //Если история отключена
                if (!History.enable) return { content: `${author}, история выключена!`, color: "Yellow" };

                const file = History.getFile(message.guildId);

                //Если нет файла
                if (!file) return { content: `${author}, на этом сервере еще не включали музыку!`, color: "Yellow" };

                const jsonFile = JSON.parse(file);

                //Создаем странички
                const pages = ArraySort<any>(10, jsonFile.tracks, (track) =>
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
        });
    };
}

export default Object.values({Command_Queue, Command_Channel, Command_History});